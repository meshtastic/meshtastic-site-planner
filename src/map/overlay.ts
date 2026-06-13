/* Coverage overlay construction for MapLibre.
 *
 * The engine produces an equirectangular (EPSG:4326) dBm grid; MapLibre
 * image sources are drawn linearly in Web Mercator. Rendering the grid
 * 1:1 would misplace mid-latitudes by several pixels over a multi-degree
 * extent, so each output row is sampled from the source row whose
 * latitude corresponds to that mercator Y - giving exact registration
 * (the same job georaster-layer's reprojection did under Leaflet).
 *
 * Colors come from the matplotlib-derived LUTs; pixels below the receiver
 * sensitivity or never computed are fully transparent. Everything is pure
 * pixel work on typed arrays, so re-coloring is cheap.
 */

import type { CoverageResult } from '../engine/CoverageEngine';
import { colormapLut } from '../render/colormaps';

export interface DisplaySettings {
  color_scale: string;
  min_dbm: number;
  max_dbm: number;
  /** percent, 0-100 */
  overlay_transparency: number;
}

/**
 * Crop a coverage result to the bounding box of the simulation radius
 * (the engine grid spans whole integer degrees). Snaps to the pixel grid.
 */
export function cropToRadius(
  result: CoverageResult,
  lat: number,
  lon: number,
  radiusMeters: number
): CoverageResult {
  const dpp = result.pixelDegrees;
  const deltaLat = (radiusMeters / 6378137) * (180 / Math.PI);
  const deltaLon = deltaLat / Math.cos((lat * Math.PI) / 180);

  const { north, west } = result.bounds;
  const row0 = Math.max(0, Math.floor((north - (lat + deltaLat)) / dpp));
  const row1 = Math.min(result.height, Math.ceil((north - (lat - deltaLat)) / dpp) + 1);
  const col0 = Math.max(0, Math.floor((lon - deltaLon - west) / dpp));
  const col1 = Math.min(result.width, Math.ceil((lon + deltaLon - west) / dpp) + 1);

  const width = Math.max(0, col1 - col0);
  const height = Math.max(0, row1 - row0);
  if (width === 0 || height === 0 || (width === result.width && height === result.height))
    return result;

  const dbm = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const src = (row0 + r) * result.width + col0;
    dbm.set(result.dbm.subarray(src, src + width), r * width);
  }

  return {
    ...result,
    dbm,
    width,
    height,
    bounds: {
      north: north - row0 * dpp,
      south: north - row1 * dpp,
      west: west + col0 * dpp,
      east: west + col1 * dpp,
    },
  };
}

function mercatorY(latDeg: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360));
}

function latFromMercatorY(y: number): number {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
}

export interface CoverageImage {
  /** PNG data URL of the mercator-projected overlay. */
  url: string;
  /** Image-source corners: [[w,n],[e,n],[e,s],[w,s]] in lng/lat. */
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
}

/** Render a coverage result into a mercator-registered overlay image. */
export function coverageImage(
  result: CoverageResult,
  display: DisplaySettings,
  sensitivityDbm: number
): CoverageImage {
  const { width, height, dbm, bounds } = result;
  const lut = colormapLut(display.color_scale);
  const min = display.min_dbm;
  const max = display.max_dbm;
  const span = max > min ? max - min : 1;
  const alpha = Math.round(255 * (1 - display.overlay_transparency / 100));

  // Color each source row once, then place rows by mercator latitude.
  const srcRGBA = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = dbm[i];
    if (Number.isNaN(v) || v < sensitivityDbm) continue; // transparent
    let t = (v - min) / span;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const c = Math.round(t * 255) * 3;
    const o = i * 4;
    srcRGBA[o] = lut[c];
    srcRGBA[o + 1] = lut[c + 1];
    srcRGBA[o + 2] = lut[c + 2];
    srcRGBA[o + 3] = alpha;
  }

  const yN = mercatorY(bounds.north);
  const yS = mercatorY(bounds.south);
  const dpp = result.pixelDegrees;
  const out = new Uint8ClampedArray(srcRGBA.length);
  const rowBytes = width * 4;
  for (let r = 0; r < height; r++) {
    const y = yN + ((r + 0.5) / height) * (yS - yN);
    const lat = latFromMercatorY(y);
    let srcRow = Math.floor((bounds.north - lat) / dpp);
    if (srcRow < 0) srcRow = 0;
    if (srcRow >= height) srcRow = height - 1;
    out.set(srcRGBA.subarray(srcRow * rowBytes, (srcRow + 1) * rowBytes), r * rowBytes);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(out, width, height), 0, 0);

  return {
    url: canvas.toDataURL('image/png'),
    coordinates: [
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.east, bounds.south],
      [bounds.west, bounds.south],
    ],
  };
}
