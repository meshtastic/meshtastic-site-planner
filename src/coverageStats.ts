/* Per-site coverage statistics derived from the dBm grid (spruce-up): how much
 * area a site actually covers, how far it reaches, and what fraction of the
 * plotted disk is usable. Pure + dependency-free so it is unit-tested and can
 * run anywhere (it just walks the Float32 grid the engine returns). */

import type { CoverageResult } from './engine/CoverageEngine';

export interface CoverageStats {
  /** Coverage threshold used (the receiver sensitivity), dBm. */
  thresholdDbm: number;
  /** Ground area receiving >= threshold, square kilometres. */
  areaKm2: number;
  /** Farthest covered point from the transmitter, kilometres. */
  maxRangeKm: number;
  /** Covered cells / computed (in-radius) cells, 0..1. */
  coveredFraction: number;
}

const M_PER_DEG_LAT = 111320;
const EARTH_R_M = 6371000;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Walk the (radius-cropped) dBm grid. NaN cells are outside the computed disk
 * and ignored; cells at or above `thresholdDbm` count as covered. Cell area
 * shrinks with latitude (cos), computed once per row.
 */
export function coverageStats(
  result: CoverageResult,
  txLat: number,
  txLon: number,
  thresholdDbm: number
): CoverageStats {
  const { dbm, width, height, bounds, pixelDegrees } = result;
  const cellHeightM = pixelDegrees * M_PER_DEG_LAT;

  let coveredCells = 0;
  let computedCells = 0;
  let areaM2 = 0;
  let maxRangeM = 0;

  for (let row = 0; row < height; row++) {
    const lat = bounds.north - (row + 0.5) * pixelDegrees;
    const cellAreaM2 = cellHeightM * cellHeightM * Math.cos((lat * Math.PI) / 180);
    const base = row * width;
    for (let col = 0; col < width; col++) {
      const v = dbm[base + col];
      if (Number.isNaN(v)) continue;
      computedCells++;
      if (v >= thresholdDbm) {
        coveredCells++;
        areaM2 += cellAreaM2;
        const lon = bounds.west + (col + 0.5) * pixelDegrees;
        const d = haversineM(txLat, txLon, lat, lon);
        if (d > maxRangeM) maxRangeM = d;
      }
    }
  }

  return {
    thresholdDbm,
    areaKm2: areaM2 / 1e6,
    maxRangeKm: maxRangeM / 1000,
    coveredFraction: computedCells ? coveredCells / computedCells : 0,
  };
}
