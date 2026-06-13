import { describe, it, expect } from 'vitest';

import { analyzeLink, FRESNEL_CLEAR_FRACTION, type LinkAnalysisInput } from '../../src/engine/link';
import type { LinkProfilePoint } from '../../src/engine/core';

/** Flat ground profile from 0..distKm at 1 km steps, all at `groundM`. */
function flat(distKm: number, groundM = 0): LinkProfilePoint[] {
  const pts: LinkProfilePoint[] = [];
  for (let d = 0; d <= distKm; d++) pts.push({ distanceKm: d, groundM });
  return pts;
}

const base = {
  frequencyMhz: 915,
  dbm: -100,
  rxGainDbi: 3,
  rxSensitivityDbm: -130,
} satisfies Omit<LinkAnalysisInput, 'profile' | 'txHeightM' | 'rxHeightM'>;

describe('analyzeLink', () => {
  it('clears a short flat link but not its full Fresnel zone (low antennas)', () => {
    const a = analyzeLink({ ...base, profile: flat(5), txHeightM: 10, rxHeightM: 10 });
    expect(a.distanceKm).toBe(5);
    expect(a.losClear).toBe(true);
    // Worst clearance is at mid-path where the curvature bulge peaks (~0.35 m).
    expect(a.worstClearanceM).toBeCloseTo(9.647, 2);
    // 10 m of clearance is < 60% of the ~20 m first Fresnel radius at midpoint.
    expect(a.fresnelClearanceFraction).toBeCloseTo(0.486, 2);
    expect(a.fresnelClear).toBe(false);
  });

  it('clears the Fresnel zone with tall antennas', () => {
    const a = analyzeLink({ ...base, profile: flat(5), txHeightM: 60, rxHeightM: 60 });
    expect(a.losClear).toBe(true);
    expect(a.fresnelClearanceFraction).toBeGreaterThan(FRESNEL_CLEAR_FRACTION);
    expect(a.fresnelClear).toBe(true);
  });

  it('reports a terrain obstruction as blocked line-of-sight', () => {
    const profile: LinkProfilePoint[] = [
      { distanceKm: 0, groundM: 0 },
      { distanceKm: 1, groundM: 0 },
      { distanceKm: 2, groundM: 0 },
      { distanceKm: 2.5, groundM: 100 }, // a 100 m hill mid-path
      { distanceKm: 3, groundM: 0 },
      { distanceKm: 4, groundM: 0 },
      { distanceKm: 5, groundM: 0 },
    ];
    const a = analyzeLink({ ...base, profile, txHeightM: 10, rxHeightM: 10 });
    expect(a.losClear).toBe(false);
    expect(a.worstClearanceM).toBeLessThan(0);
    expect(a.fresnelClear).toBe(false);
  });

  it('blocks a long flat link by earth curvature alone', () => {
    // 60 km with 5 m antennas: the ~53 m mid-path bulge swamps the ray.
    const a = analyzeLink({ ...base, profile: flat(60), txHeightM: 5, rxHeightM: 5 });
    expect(a.losClear).toBe(false);
    expect(a.worstClearanceM).toBeLessThan(-40);
  });

  it('computes the link budget with RX antenna gain', () => {
    const a = analyzeLink({ ...base, profile: flat(5), txHeightM: 10, rxHeightM: 10 });
    expect(a.rxDbm).toBe(-97); // -100 dBm + 3 dBi
    expect(a.marginDb).toBe(33); // -97 - (-130)
  });

  it('reports a negative margin when received power is below sensitivity', () => {
    const a = analyzeLink({
      ...base,
      profile: flat(5),
      txHeightM: 10,
      rxHeightM: 10,
      dbm: -135,
      rxGainDbi: 0,
    });
    expect(a.rxDbm).toBe(-135);
    expect(a.marginDb).toBe(-5);
  });

  it('returns a chart sample per profile point with ray at the antenna heights', () => {
    const a = analyzeLink({ ...base, profile: flat(5, 100), txHeightM: 10, rxHeightM: 20 });
    expect(a.samples).toHaveLength(6);
    expect(a.samples[0].rayM).toBeCloseTo(110, 6); // 100 m ground + 10 m TX
    expect(a.samples[a.samples.length - 1].rayM).toBeCloseTo(120, 6); // 100 + 20 RX
  });
});
