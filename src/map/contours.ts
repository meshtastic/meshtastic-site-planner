/* Vector coverage contours.
 *
 * Turns the engine's Float32 dBm grid into GeoJSON iso-bands (filled
 * "signal ≥ X dBm" regions) via d3-contour. MapLibre renders these as
 * native fill/line layers — crisp at any zoom, tappable, and a fraction of
 * the bytes of a raster.
 *
 * This function is intentionally pure (CoverageResult + options -> GeoJSON)
 * and free of any MapLibre/DOM dependency, so the exact same code can back
 * a server/edge API that returns contours to the Android / iOS apps.
 */

import { contours as d3contours } from 'd3-contour';
import type { Feature, FeatureCollection, MultiPolygon, Position } from 'geojson';

import type { CoverageResult } from '../engine/CoverageEngine';
import { colormapLut } from '../render/colormaps';

export interface ContourOptions {
  /** Colormap name for per-band fill color (matches the heatmap). */
  colorScale: string;
  /** dBm range the colormap spans. */
  minDbm: number;
  maxDbm: number;
  /** Receiver sensitivity: nothing weaker than this is drawn. */
  sensitivityDbm: number;
  /** Number of bands between the floor and maxDbm (default 12). */
  bands?: number;
  /** Contour at most this many cells on the long axis (default 900);
   * larger grids are block-averaged down first to bound cost + size. */
  maxDimension?: number;
  /** Box-blur radius (in grid cells) applied to the field before contouring.
   * Rounds the marching-squares stair-steps into smooth curves. 0 disables;
   * default 1. Bands stay nested because they derive from one smoothed field. */
  smoothing?: number;
}

interface PreparedGrid {
  values: Float64Array;
  width: number;
  height: number;
}

/** NaN-aware block-average downsample, with no-coverage cells set to a
 * sentinel well below every threshold so they fall outside all bands. */
function prepareGrid(result: CoverageResult, maxDimension: number, sentinel: number): PreparedGrid {
  const { dbm, width: W, height: H } = result;
  const stride = Math.max(1, Math.ceil(Math.max(W, H) / maxDimension));

  if (stride === 1) {
    const values = new Float64Array(W * H);
    for (let i = 0; i < values.length; i++) values[i] = Number.isNaN(dbm[i]) ? sentinel : dbm[i];
    return { values, width: W, height: H };
  }

  const w = Math.ceil(W / stride);
  const h = Math.ceil(H / stride);
  const values = new Float64Array(w * h);
  for (let oy = 0; oy < h; oy++) {
    for (let ox = 0; ox < w; ox++) {
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < stride; dy++) {
        const y = oy * stride + dy;
        if (y >= H) break;
        for (let dx = 0; dx < stride; dx++) {
          const x = ox * stride + dx;
          if (x >= W) break;
          const v = dbm[y * W + x];
          if (!Number.isNaN(v)) {
            sum += v;
            n++;
          }
        }
      }
      values[oy * w + ox] = n ? sum / n : sentinel;
    }
  }
  return { values, width: w, height: h };
}

/** Separable box blur (radius r, `passes` passes ≈ a Gaussian) over a w×h
 * grid; border samples clamp to the edge. Never mutates the input. */
function blurGrid(src: Float64Array, w: number, h: number, r: number, passes: number): Float64Array {
  const win = 2 * r + 1;
  let cur = Float64Array.from(src);
  const tmp = new Float64Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
          sum += cur[row + xx];
        }
        tmp[row + x] = sum / win;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
          sum += tmp[yy * w + x];
        }
        cur[y * w + x] = sum / win;
      }
    }
  }
  return cur;
}

/**
 * Coverage as GeoJSON iso-bands. Each feature is the region where the
 * received signal is ≥ that band's dBm level (nested, strongest last so
 * stacking paints concentric color bands), with `color`, `dbm`, and a
 * human `label` in its properties.
 */
export function coverageContours(result: CoverageResult, opts: ContourOptions): FeatureCollection {
  const bands = opts.bands ?? 12;
  const floor = Math.max(opts.minDbm, opts.sensitivityDbm);
  const ceil = opts.maxDbm;

  // Ascending thresholds from the coverage floor up to maxDbm.
  const span = ceil > floor ? ceil - floor : 1;
  const levels: number[] = [];
  for (let i = 0; i < bands; i++) levels.push(floor + (span * i) / bands);

  // No-data sits just below the lowest band (not far below it) so the
  // pre-contour blur feathers the coverage edge smoothly instead of the old
  // very-negative sentinel dragging nearby signal down across the threshold.
  const sentinel = floor - Math.max(6, span / bands);
  const grid = prepareGrid(result, opts.maxDimension ?? 900, sentinel);

  // Smooth the field before contouring so the iso-bands are curved rather than
  // following the grid in stair-steps. One smoothed field keeps bands nested.
  const radius = Math.round(opts.smoothing ?? 1);
  const field = radius >= 1 ? blurGrid(grid.values, grid.width, grid.height, radius, 3) : grid.values;
  const polys = d3contours()
    .size([grid.width, grid.height])
    // d3-contour types want number[], but only index the array at runtime;
    // a typed array is fine and avoids a copy.
    .thresholds(levels)(field as unknown as number[]);

  const lut = colormapLut(opts.colorScale);
  const colorSpan = opts.maxDbm > opts.minDbm ? opts.maxDbm - opts.minDbm : 1;

  // Grid (x in [0,w], y in [0,h], y downward) -> lon/lat over the bounds.
  const { west, north, east, south } = result.bounds;
  const lonPerX = (east - west) / grid.width;
  const latPerY = (north - south) / grid.height;
  const toLngLat = (p: Position): Position => [west + p[0] * lonPerX, north - p[1] * latPerY];

  const features: Feature[] = polys
    .filter((c) => Array.isArray(c.coordinates) && c.coordinates.length > 0)
    .map((c) => {
      const t = (c.value - opts.minDbm) / colorSpan;
      const ci = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
      const color = `rgb(${lut[ci]}, ${lut[ci + 1]}, ${lut[ci + 2]})`;
      const geometry: MultiPolygon = {
        type: 'MultiPolygon',
        coordinates: c.coordinates.map((poly) => poly.map((ring) => ring.map(toLngLat))),
      };
      return {
        type: 'Feature',
        properties: { dbm: Math.round(c.value), color, label: `≥ ${Math.round(c.value)} dBm` },
        geometry,
      };
    });

  return { type: 'FeatureCollection', features };
}
