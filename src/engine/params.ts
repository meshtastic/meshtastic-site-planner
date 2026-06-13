/* Mapping from the site planner's request shape (the legacy backend's
 * CoveragePredictionRequest fields) to engine parameters, replicating the
 * backend's conversions bit-for-bit — including its quirks — so results
 * match the golden fixtures:
 *
 *  - ERP = 10^((tx_power_dbm + tx_gain - system_loss - 30) / 10), written
 *    into the .lrp with %.2f (app/services/splat.py:416,433). rx_gain was
 *    accepted by the API but never used; we keep ignoring it.
 *  - situation/time fractions were written with %.2f after /100.
 *  - The QTH file had no meters suffix, so SPLAT! consumed tx_height as
 *    FEET (LoadQTH, splat/splat.cpp:1249-1262). legacyTxHeightAsFeet=true
 *    reproduces that for golden parity; the UI passes false to get the
 *    correct meters -> feet conversion.
 *  - rx height (-L, -metric) was correctly converted meters -> feet.
 *  - The radius was clamped to 100 km server-side.
 */

import type { EngineRunParams } from './core';

export const CLIMATE_CODES: Record<string, number> = {
  equatorial: 1,
  continental_subtropical: 2,
  maritime_subtropical: 3,
  desert: 4,
  continental_temperate: 5,
  maritime_temperate_land: 6,
  maritime_temperate_sea: 7,
};

export const POLARIZATION_CODES: Record<string, 0 | 1> = {
  horizontal: 0,
  vertical: 1,
};

export const METERS_PER_FOOT = 0.3048;
/**
 * Standard-resolution radius cap. The engine's compiled page region
 * (SPLAT MAXPAGES=64 -> deg_limit 3.5 deg) spans at most +/-3.5 deg from
 * the transmitter, i.e. ~321 km N-S and ~321*cos(lat) km E-W. At 60 deg N
 * (the edge of SRTM coverage) the E-W limit is ~160 km, so 150 km is the
 * largest radius that plots without silently clipping anywhere terrain
 * data exists. LoRa links can exceed this, but the model would have no
 * elevation data past the region edge.
 */
export const MAX_RADIUS_METERS = 150000;
/** HD (30 m) terrain uses 9x the memory/compute; cap the radius. */
export const MAX_RADIUS_METERS_HD = 30000;

export interface CoverageRequest {
  lat: number;
  lon: number;
  /** meters in the UI; see legacyTxHeightAsFeet */
  tx_height: number;
  /** dBm */
  tx_power: number;
  tx_gain: number;
  system_loss: number;
  frequency_mhz: number;
  rx_height: number;
  clutter_height: number;
  ground_dielectric: number;
  ground_conductivity: number;
  atmosphere_bending: number;
  radio_climate: keyof typeof CLIMATE_CODES | string;
  polarization: keyof typeof POLARIZATION_CODES | string;
  /** meters */
  radius: number;
  /** percent */
  situation_fraction: number;
  time_fraction: number;
  /** 1-arcsecond (30 m) terrain instead of the default 3-arcsecond (90 m). */
  high_resolution?: boolean;
}

export interface ToEngineParamsOptions {
  /**
   * Reproduce the legacy backend bug where tx_height (meters in the UI)
   * reached SPLAT! unconverted and was consumed as feet. Golden tests set
   * this; the UI should not.
   */
  legacyTxHeightAsFeet?: boolean;
}

/** %.2f formatting as Python's f-string applied to lrp values. */
function round2(x: number): number {
  return Number(x.toFixed(2));
}

export function erpWatts(req: Pick<CoverageRequest, 'tx_power' | 'tx_gain' | 'system_loss'>): number {
  return 10 ** ((req.tx_power + req.tx_gain - req.system_loss - 30) / 10);
}

export function toEngineParams(
  req: CoverageRequest,
  opts: ToEngineParamsOptions = {}
): EngineRunParams {
  const climate = CLIMATE_CODES[req.radio_climate];
  const pol = POLARIZATION_CODES[req.polarization];
  if (climate === undefined) throw new Error(`unknown radio climate: ${req.radio_climate}`);
  if (pol === undefined) throw new Error(`unknown polarization: ${req.polarization}`);

  const hd = req.high_resolution === true;
  const radiusM = Math.min(req.radius, hd ? MAX_RADIUS_METERS_HD : MAX_RADIUS_METERS);

  return {
    lat: req.lat,
    lon: req.lon,
    txAltFeet: opts.legacyTxHeightAsFeet
      ? req.tx_height
      : req.tx_height / METERS_PER_FOOT,
    rxAltFeet: req.rx_height / METERS_PER_FOOT,
    frequencyMhz: req.frequency_mhz,
    erpWatts: round2(erpWatts(req)),
    groundDielectric: req.ground_dielectric,
    groundConductivity: req.ground_conductivity,
    atmosphereBending: req.atmosphere_bending,
    radioClimate: climate,
    polarization: pol,
    conf: round2(req.situation_fraction / 100),
    rel: round2(req.time_fraction / 100),
    clutterHeightM: req.clutter_height,
    radiusKm: radiusM / 1000,
    resolutionIppd: hd ? 3600 : 1200,
  };
}
