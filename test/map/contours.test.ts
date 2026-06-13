/* Unit tests for the pure GeoJSON contour generator. No DOM / MapLibre, so
 * this is exactly the surface a future server/edge API would call. */

import { describe, expect, it } from 'vitest';

import { coverageContours } from '../../src/map/contours';
import type { CoverageResult } from '../../src/engine/CoverageEngine';

/** Synthetic coverage: strong at center, fading out, NaN (no coverage)
 * beyond a radius — a radially-symmetric blob inside a 0.2°x0.2° box. */
function syntheticResult(w = 40, h = 40): CoverageResult {
  const dbm = new Float32Array(w * h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const maxR = w / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.hypot(x - cx, y - cy);
      dbm[y * w + x] = r > maxR ? NaN : -80 - (r / maxR) * 55; // -80 center → -135 edge
    }
  }
  return {
    dbm,
    width: w,
    height: h,
    bounds: { north: 51.2, south: 51.0, east: -114.0, west: -114.2 },
    pixelDegrees: 0.2 / w,
    stats: { radials: 0, pages: 1, pagesWithData: 1, itmWarnings: [], elapsedMs: 0, workers: 1 },
  };
}

describe('coverageContours', () => {
  const opts = { colorScale: 'plasma', minDbm: -130, maxDbm: -80, sensitivityDbm: -130 };

  it('produces colored, labeled bands within the result bounds', () => {
    const result = syntheticResult();
    const fc = coverageContours(result, opts);

    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.length).toBeGreaterThan(0);
    expect(fc.features.length).toBeLessThanOrEqual(12); // default band count

    for (const f of fc.features) {
      expect(f.geometry.type).toBe('MultiPolygon');
      const p = f.properties as { color: string; dbm: number; label: string };
      expect(p.color).toMatch(/^rgb\(/);
      expect(Number.isInteger(p.dbm)).toBe(true);
      expect(p.label).toContain('dBm');
      // No NaN coordinates leak through (validates the no-data sentinel).
      const coords = (f.geometry as { coordinates: number[][][][] }).coordinates;
      for (const poly of coords)
        for (const ring of poly)
          for (const [lng, lat] of ring) {
            expect(Number.isFinite(lng)).toBe(true);
            expect(Number.isFinite(lat)).toBe(true);
            expect(lng).toBeGreaterThanOrEqual(-114.2001);
            expect(lng).toBeLessThanOrEqual(-113.9999);
            expect(lat).toBeGreaterThanOrEqual(50.9999);
            expect(lat).toBeLessThanOrEqual(51.2001);
          }
    }
  });

  it('includes a strong-signal band and distinct per-band colors', () => {
    const fc = coverageContours(syntheticResult(), opts);
    const dbms = fc.features.map((f) => (f.properties as { dbm: number }).dbm);
    expect(Math.max(...dbms)).toBeGreaterThanOrEqual(-95); // center reaches strong levels
    expect(Math.min(...dbms)).toBeLessThanOrEqual(-120); // weak fringe present
    const colors = new Set(fc.features.map((f) => (f.properties as { color: string }).color));
    expect(colors.size).toBeGreaterThan(1); // colormap actually applied across bands
  });

  it('smoothing changes the geometry while keeping bands finite and in-bounds', () => {
    const result = syntheticResult();
    const raw = coverageContours(result, { ...opts, smoothing: 0 });
    const smooth = coverageContours(result, { ...opts, smoothing: 2 });

    // The smoothing parameter actually reshapes the rings (it is not a no-op).
    const geom = (fc: ReturnType<typeof coverageContours>) =>
      JSON.stringify(fc.features.map((f) => f.geometry.coordinates));
    expect(geom(smooth)).not.toBe(geom(raw));

    // Smoothing must not leak the no-data sentinel or push points out of bounds.
    for (const f of smooth.features) {
      const coords = (f.geometry as { coordinates: number[][][][] }).coordinates;
      for (const poly of coords)
        for (const ring of poly)
          for (const [lng, lat] of ring) {
            expect(Number.isFinite(lng) && Number.isFinite(lat)).toBe(true);
            expect(lng).toBeGreaterThanOrEqual(-114.2001);
            expect(lng).toBeLessThanOrEqual(-113.9999);
            expect(lat).toBeGreaterThanOrEqual(50.9999);
            expect(lat).toBeLessThanOrEqual(51.2001);
          }
    }
  });

  it('excludes everything when nothing meets the sensitivity floor', () => {
    const result = syntheticResult();
    // Sensitivity above the strongest signal -> no coverage at all.
    const fc = coverageContours(result, { ...opts, sensitivityDbm: -50 });
    const totalRings = fc.features.reduce(
      (n, f) => n + (f.geometry as { coordinates: unknown[] }).coordinates.length,
      0
    );
    expect(totalRings).toBe(0);
  });
});
