/* Pure point-to-point link analysis (issue #14): line-of-sight with earth
 * curvature, first-Fresnel-zone clearance, and a link budget. It operates on
 * the ground profile the engine returns (src/engine/core.ts pointToPoint), so
 * it has no WASM or DOM dependency and is unit-tested directly. The ITM path
 * loss / received dBm come from the engine; this layer adds the geometry the
 * coverage model doesn't expose (clearance) plus the receiver-side budget. */

import type { LinkProfilePoint } from './core';

const SPEED_OF_LIGHT = 299792458; // m/s
const EARTH_RADIUS_M = 6371000;
/** Standard atmospheric refraction (4/3-earth model), as ITM assumes. */
const K_FACTOR = 4 / 3;
const EFFECTIVE_EARTH_M = EARTH_RADIUS_M * K_FACTOR;
/** Rule of thumb: a link is "clear" with >= 60% of the first Fresnel zone. */
export const FRESNEL_CLEAR_FRACTION = 0.6;

export interface LinkAnalysisInput {
  /** Ground profile from TX (index 0) to target (last), km + meters. */
  profile: LinkProfilePoint[];
  /** Antenna heights above ground, meters. */
  txHeightM: number;
  rxHeightM: number;
  frequencyMhz: number;
  /** Engine received signal at the target, dBm (excludes RX antenna gain). */
  dbm: number;
  rxGainDbi: number;
  rxSensitivityDbm: number;
}

export interface LinkSample {
  distanceKm: number;
  groundM: number;
  /** Ground raised by the earth-curvature bulge: what the ray must clear. */
  curvedGroundM: number;
  /** Straight line-of-sight ray height at this distance, meters. */
  rayM: number;
  /** Bottom of the first Fresnel zone (rayM - first-Fresnel radius). */
  fresnelBottomM: number;
}

export interface LinkAnalysis {
  distanceKm: number;
  /** Straight ray clears the curved terrain everywhere between the antennas. */
  losClear: boolean;
  /** Worst (smallest) vertical gap from the ray down to the curved terrain. */
  worstClearanceM: number;
  /** Worst clearance as a fraction of the first Fresnel radius at that point. */
  fresnelClearanceFraction: number;
  /** Worst clearance keeps >= 60% of the first Fresnel zone. */
  fresnelClear: boolean;
  /** Received power including the RX antenna gain, dBm. */
  rxDbm: number;
  /** Link margin over the receiver sensitivity, dB (>= 0 closes the link). */
  marginDb: number;
  /** Per-point series for the profile chart. */
  samples: LinkSample[];
}

/**
 * Analyze a TX->target link. The terrain bulge d1*d2/(2*kR) is added to the
 * ground (equivalently, the straight ray is drawn over a flattened earth), and
 * the first Fresnel radius is sqrt(lambda * d1 * d2 / D). Endpoints are excluded
 * from the worst-case search (the antennas sit at the ends by definition).
 */
export function analyzeLink(input: LinkAnalysisInput): LinkAnalysis {
  const { profile, txHeightM, rxHeightM, frequencyMhz } = input;
  const n = profile.length;
  const distanceKm = n > 0 ? profile[n - 1].distanceKm : 0;
  const totalM = distanceKm * 1000;
  const wavelengthM = SPEED_OF_LIGHT / (frequencyMhz * 1e6);

  const txElevM = (profile[0]?.groundM ?? 0) + txHeightM;
  const rxElevM = (profile[n - 1]?.groundM ?? 0) + rxHeightM;

  const samples: LinkSample[] = [];
  let worstClearanceM = Infinity;
  let fresnelClearanceFraction = Infinity;

  for (let i = 0; i < n; i++) {
    const d1 = profile[i].distanceKm * 1000; // from TX
    const d2 = Math.max(0, totalM - d1); // to target
    const bulge = totalM > 0 ? (d1 * d2) / (2 * EFFECTIVE_EARTH_M) : 0;
    const curvedGroundM = profile[i].groundM + bulge;
    const rayM = totalM > 0 ? txElevM + (rxElevM - txElevM) * (d1 / totalM) : txElevM;
    const clearance = rayM - curvedGroundM;
    const fresnelR = totalM > 0 ? Math.sqrt((wavelengthM * d1 * d2) / totalM) : 0;

    if (i > 0 && i < n - 1) {
      if (clearance < worstClearanceM) worstClearanceM = clearance;
      const frac = fresnelR > 0 ? clearance / fresnelR : Infinity;
      if (frac < fresnelClearanceFraction) fresnelClearanceFraction = frac;
    }

    samples.push({
      distanceKm: profile[i].distanceKm,
      groundM: profile[i].groundM,
      curvedGroundM,
      rayM,
      fresnelBottomM: rayM - fresnelR,
    });
  }

  // Degenerate path (< 3 points): no interior obstruction possible.
  if (!Number.isFinite(worstClearanceM)) worstClearanceM = Math.min(txHeightM, rxHeightM);
  if (!Number.isFinite(fresnelClearanceFraction)) fresnelClearanceFraction = 1;

  const rxDbm = input.dbm + input.rxGainDbi;

  return {
    distanceKm,
    losClear: worstClearanceM >= 0,
    worstClearanceM,
    fresnelClearanceFraction,
    fresnelClear: fresnelClearanceFraction >= FRESNEL_CLEAR_FRACTION,
    rxDbm,
    marginDb: rxDbm - input.rxSensitivityDbm,
    samples,
  };
}
