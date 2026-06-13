import { describe, it, expect } from 'vitest';

import { mergeParams } from '../src/persist';
import type { SplatParams } from '../src/types';

function defaults(): SplatParams {
  return {
    transmitter: { name: 'Default', tx_lat: 51, tx_lon: -114, tx_power: 0.1, tx_freq: 907, tx_height: 2, tx_gain: 2 },
    receiver: { rx_sensitivity: -130, rx_height: 1, rx_gain: 2, rx_loss: 2 },
    environment: { radio_climate: 'continental_temperate', polarization: 'vertical', clutter_height: 1, ground_dielectric: 15, ground_conductivity: 0.005, atmosphere_bending: 301 },
    simulation: { situation_fraction: 95, time_fraction: 95, simulation_extent: 30, high_resolution: false },
    display: { color_scale: 'plasma', min_dbm: -130, max_dbm: -80, overlay_transparency: 50 },
  };
}

describe('mergeParams', () => {
  it('overlays saved values onto the defaults', () => {
    const saved = { transmitter: { tx_lat: 40, tx_lon: -100, tx_power: 1 } };
    const merged = mergeParams(defaults(), saved);
    expect(merged.transmitter.tx_lat).toBe(40);
    expect(merged.transmitter.tx_power).toBe(1);
    // Untouched fields keep their defaults.
    expect(merged.transmitter.tx_freq).toBe(907);
    expect(merged.receiver.rx_sensitivity).toBe(-130);
  });

  it('fills a missing section from the defaults', () => {
    const merged = mergeParams(defaults(), { display: { min_dbm: -120 } });
    expect(merged.display.min_dbm).toBe(-120);
    expect(merged.display.color_scale).toBe('plasma'); // default kept
    expect(merged.simulation.simulation_extent).toBe(30); // whole section defaulted
  });

  it.each([null, undefined, 42, 'oops', []])('returns defaults for malformed input %s', (bad) => {
    expect(mergeParams(defaults(), bad)).toEqual(defaults());
  });

  it('ignores an array where a section object is expected', () => {
    const merged = mergeParams(defaults(), { receiver: [1, 2, 3] });
    expect(merged.receiver).toEqual(defaults().receiver);
  });
});
