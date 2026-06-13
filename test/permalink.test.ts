import { describe, it, expect } from 'vitest';

import { encodeParams, decodeParams } from '../src/permalink';
import type { SplatParams } from '../src/types';

function sample(): SplatParams {
  return {
    transmitter: { name: 'Tower A', tx_lat: 51.105, tx_lon: -114.07, tx_power: 0.5, tx_freq: 915, tx_height: 12, tx_gain: 5.5 },
    receiver: { rx_sensitivity: -130, rx_height: 1.5, rx_gain: 3, rx_loss: 2 },
    environment: { radio_climate: 'maritime_temperate_land', polarization: 'vertical', clutter_height: 1, ground_dielectric: 15, ground_conductivity: 0.005, atmosphere_bending: 301 },
    simulation: { situation_fraction: 90, time_fraction: 90, simulation_extent: 25, high_resolution: true },
    display: { color_scale: 'turbo', min_dbm: -125, max_dbm: -75, overlay_transparency: 40 },
  };
}

describe('permalink codec', () => {
  it('round-trips parameters through encode/decode', () => {
    const params = sample();
    const decoded = decodeParams(encodeParams(params));
    expect(decoded).toEqual(params);
  });

  it('produces a URL-safe string (no +, /, or = padding)', () => {
    const enc = encodeParams(sample());
    expect(enc).not.toMatch(/[+/=]/);
  });

  it('handles non-ASCII site names', () => {
    const params = sample();
    params.transmitter.name = 'Tower Ñörð 🗻';
    expect(decodeParams(encodeParams(params))).toEqual(params);
  });

  it('returns null for malformed encodings', () => {
    expect(decodeParams('not-valid-base64!!')).toBeNull();
    expect(decodeParams('')).toBeNull();
  });
});
