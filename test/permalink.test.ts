import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  encodeParams,
  decodeParams,
  decodeSharedQuery,
  sharedRunRequested,
} from '../src/permalink';
import type { SplatParams } from '../src/types';

/** Stub the global `location` (absent in the node test env) with a given URL. */
function stubLocation(search: string, hash = ''): void {
  vi.stubGlobal('location', { search, hash, pathname: '/', origin: 'https://x' });
}

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

describe('app hand-off query contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses lat/lon/name and numeric tx_* into a partial transmitter', () => {
    stubLocation('?lat=51.05&lon=-114.07&name=Tower%20A&tx_power=0.5&tx_freq=915&tx_height=12&tx_gain=5.5');
    expect(decodeSharedQuery()).toEqual({
      transmitter: { tx_lat: 51.05, tx_lon: -114.07, name: 'Tower A', tx_power: 0.5, tx_freq: 915, tx_height: 12, tx_gain: 5.5 },
    });
  });

  it('passes a known color_scale into display but drops an unknown one', () => {
    stubLocation('?lat=51.05&color_scale=turbo');
    expect(decodeSharedQuery()).toEqual({ transmitter: { tx_lat: 51.05 }, display: { color_scale: 'turbo' } });
    stubLocation('?lat=51.05&color_scale=bogus');
    expect(decodeSharedQuery()).toEqual({ transmitter: { tx_lat: 51.05 } });
  });

  it('maps advanced keys onto their sections (receiver / simulation / environment / display)', () => {
    stubLocation(
      '?rx_sensitivity=-135&rx_height=3&rx_loss=1&max_range=50&high_res=1' +
        '&situation_fraction=90&clutter_height=2&min_dbm=-140&max_dbm=-70&overlay_transparency=25',
    );
    expect(decodeSharedQuery()).toEqual({
      receiver: { rx_sensitivity: -135, rx_height: 3, rx_loss: 1 },
      simulation: { simulation_extent: 50, high_resolution: true, situation_fraction: 90 },
      environment: { clutter_height: 2 },
      display: { min_dbm: -140, max_dbm: -70, overlay_transparency: 25 },
    });
  });

  it('passes known climate/polarization enums but drops unknown ones; high_res=0 is false', () => {
    stubLocation('?radio_climate=desert&polarization=horizontal&high_res=0');
    expect(decodeSharedQuery()).toEqual({
      environment: { radio_climate: 'desert', polarization: 'horizontal' },
      simulation: { high_resolution: false },
    });
    stubLocation('?radio_climate=bogus&polarization=sideways');
    expect(decodeSharedQuery()).toBeNull();
  });

  it('omits missing and non-numeric fields, and returns null when nothing usable', () => {
    stubLocation('?lat=51.05&tx_power=abc');
    expect(decodeSharedQuery()).toEqual({ transmitter: { tx_lat: 51.05 } });
    stubLocation('?run=1'); // run alone is not params
    expect(decodeSharedQuery()).toBeNull();
    stubLocation('');
    expect(decodeSharedQuery()).toBeNull();
  });

  it('detects the run flag in the query or the hash, but not otherwise', () => {
    stubLocation('?run=1');
    expect(sharedRunRequested()).toBe(true);
    stubLocation('?lat=1', '#cfg=abc&run=true');
    expect(sharedRunRequested()).toBe(true);
    stubLocation('?lat=1', '#cfg=abc');
    expect(sharedRunRequested()).toBe(false);
    stubLocation('?run=0');
    expect(sharedRunRequested()).toBe(false);
  });
});
