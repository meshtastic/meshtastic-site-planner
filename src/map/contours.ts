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
  const sentinel = opts.minDbm - 100;

  // Ascending thresholds from the coverage floor up to maxDbm.
  const span = ceil > floor ? ceil - floor : 1;
  const levels: number[] = [];
  for (let i = 0; i < bands; i++) levels.push(floor + (span * i) / bands);

  const grid = prepareGrid(result, opts.maxDimension ?? 900, sentinel);
  const polys = d3contours()
    .size([grid.width, grid.height])
    // d3-contour types want number[], but only index the array at runtime;
    // a typed array is fine and avoids a copy.
    .thresholds(levels)(grid.values as unknown as number[]);

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
