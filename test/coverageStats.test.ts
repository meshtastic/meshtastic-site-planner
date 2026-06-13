import { describe, it, expect } from 'vitest';

import { coverageStats } from '../src/coverageStats';
import type { CoverageResult } from '../src/engine/CoverageEngine';

/** Minimal CoverageResult around the equator (so cos(lat) ~ 1). */
function grid(dbm: number[], width: number, height: number, pixelDegrees = 0.01): CoverageResult {
  const halfH = (height * pixelDegrees) / 2;
  const halfW = (width * pixelDegrees) / 2;
  return {
    dbm: Float32Array.from(dbm),
    width,
    height,
    bounds: { north: halfH, south: -halfH, west: -halfW, east: halfW },
    pixelDegrees,
    stats: { radials: 0, pages: 0, pagesWithData: 0, itmWarnings: [], elapsedMs: 0, workers: 1 },
  };
}

describe('coverageStats', () => {
  it('counts covered cells, area, range, and fraction', () => {
    // 2x2: two covered, one below threshold, one outside (NaN).
    const r = grid([-100, -100, -140, NaN], 2, 2);
    const s = coverageStats(r, 0, 0, -130);
    expect(s.thresholdDbm).toBe(-130);
    expect(s.coveredFraction).toBeCloseTo(2 / 3, 3); // 2 covered of 3 computed
    // Each ~1.1132 km cell ~ 1.239 km^2; two covered ~ 2.48 km^2.
    expect(s.areaKm2).toBeCloseTo(2.48, 1);
    // Covered cells sit ~0.79 km from the TX at (0,0).
    expect(s.maxRangeKm).toBeCloseTo(0.79, 1);
  });

  it('returns zeros when nothing meets the threshold', () => {
    const s = coverageStats(grid([-140, -140, NaN, NaN], 2, 2), 0, 0, -130);
    expect(s.areaKm2).toBe(0);
    expect(s.maxRangeKm).toBe(0);
    expect(s.coveredFraction).toBe(0);
  });

  it('raising the threshold shrinks the covered area', () => {
    const r = grid([-90, -110, -125, -140], 2, 2);
    const loose = coverageStats(r, 0, 0, -130).areaKm2;
    const strict = coverageStats(r, 0, 0, -100).areaKm2;
    expect(strict).toBeLessThan(loose);
    expect(strict).toBeGreaterThan(0); // only the -90 cell survives
  });

  it('ignores NaN (out-of-radius) cells entirely', () => {
    const s = coverageStats(grid([NaN, NaN, NaN, NaN], 2, 2), 0, 0, -130);
    expect(s.coveredFraction).toBe(0);
    expect(s.areaKm2).toBe(0);
  });
});
