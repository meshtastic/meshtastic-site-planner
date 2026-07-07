/* Shareable permalinks (#9): encode the site parameters into the URL hash so a
 * configured view can be bookmarked or shared. The hash (not the query string)
 * keeps it client-only — no server round-trip — and base64url-encoded JSON
 * keeps arbitrary values safe in a URL. Pure helpers (DOM access is isolated to
 * the small read/build/clear functions) so the codec is unit-testable. */

import type { SplatParams } from './types';
import { COLORMAP_NAMES } from './render/colormaps';
import { CLIMATE_CODES, POLARIZATION_CODES } from './engine/params';

const HASH_PREFIX = 'cfg=';

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** base64url(JSON(params)). */
export function encodeParams(params: SplatParams): string {
  return toBase64Url(JSON.stringify(params));
}

/** Decode an encoded params blob, or null if it isn't valid. */
export function decodeParams(encoded: string): unknown | null {
  try {
    return JSON.parse(fromBase64Url(encoded));
  } catch {
    return null;
  }
}

/** Parsed params from the current `#cfg=...` hash, or null. */
export function decodeSharedHash(): unknown | null {
  if (typeof location === 'undefined') return null;
  const hash = location.hash.replace(/^#/, '');
  const part = hash.split('&').find((p) => p.startsWith(HASH_PREFIX));
  if (!part) return null;
  return decodeParams(part.slice(HASH_PREFIX.length));
}

/** Full shareable URL for the given params. */
export function buildShareUrl(params: SplatParams): string {
  return `${location.origin}${location.pathname}#${HASH_PREFIX}${encodeParams(params)}`;
}

/** Remove the cfg hash from the address bar without reloading (so later edits
 * persist via localStorage instead of being overridden by the link on reload). */
export function clearSharedHash(): void {
  if (typeof location === 'undefined' || !location.hash.includes(HASH_PREFIX)) return;
  history.replaceState(null, '', location.pathname + location.search);
}

/* --- App hand-off (query string) --------------------------------------------
 * A stable, readable query contract so a native app (e.g. the Meshtastic mobile
 * apps) can deep-link into the planner prefilled and, optionally, auto-run —
 * without base64-encoding JSON or knowing the internal SplatParams nesting:
 *
 *   ?lat=51.05&lon=-114.07&name=Tower%20A&tx_power=0.5&tx_freq=915&tx_height=12
 *     &tx_gain=5.5&rx_sensitivity=-130&max_range=50&high_res=1&color_scale=plasma&run=1
 *
 * Keys map onto SplatParams sections via QUERY_NUM_FIELDS plus the name/bool/enum
 * handling below; only the keys present are applied (merged over the factory
 * defaults, per-section). `run=1` (also accepted in the hash) computes coverage
 * as soon as the map is ready. Unknown enum values are ignored — the default
 * applies — so a bad string can't throw in the engine or break a legend asset. */

type Section = keyof SplatParams;

// Numeric flat keys → [section, field]. Grouped by section so a partial merges
// cleanly over the defaults (mergeParams merges section-by-section).
// (rx_gain is intentionally omitted: it's ignored for area coverage, only used
// in point-to-point link analysis, so a hand-off can't meaningfully set it.)
const QUERY_NUM_FIELDS: Record<string, [Section, string]> = {
  lat: ['transmitter', 'tx_lat'],
  lon: ['transmitter', 'tx_lon'],
  tx_power: ['transmitter', 'tx_power'],
  tx_freq: ['transmitter', 'tx_freq'],
  tx_height: ['transmitter', 'tx_height'],
  tx_gain: ['transmitter', 'tx_gain'],
  rx_sensitivity: ['receiver', 'rx_sensitivity'],
  rx_height: ['receiver', 'rx_height'],
  rx_loss: ['receiver', 'rx_loss'],
  max_range: ['simulation', 'simulation_extent'],
  situation_fraction: ['simulation', 'situation_fraction'],
  time_fraction: ['simulation', 'time_fraction'],
  clutter_height: ['environment', 'clutter_height'],
  ground_dielectric: ['environment', 'ground_dielectric'],
  ground_conductivity: ['environment', 'ground_conductivity'],
  atmosphere_bending: ['environment', 'atmosphere_bending'],
  min_dbm: ['display', 'min_dbm'],
  max_dbm: ['display', 'max_dbm'],
  overlay_transparency: ['display', 'overlay_transparency'],
};

// Every hand-off key, for clearSharedQuery() (numeric + name/bool/enum + run).
const QUERY_KEYS = [
  ...Object.keys(QUERY_NUM_FIELDS),
  'name',
  'high_res',
  'radio_climate',
  'polarization',
  'color_scale',
  'run',
];

function finiteNum(s: string | null): number | null {
  if (s == null || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isTruthy(v: string | null | undefined): boolean {
  return v === '1' || v === 'true';
}

/** Partial params from the flat query hand-off contract, or null if none are
 * present. Shape matches what mergeParams() merges over defaults (per section). */
export function decodeSharedQuery(): Record<string, unknown> | null {
  if (typeof location === 'undefined' || !location.search) return null;
  const q = new URLSearchParams(location.search);
  const sections: Record<Section, Record<string, unknown>> = {
    transmitter: {},
    receiver: {},
    environment: {},
    simulation: {},
    display: {},
  };

  for (const [key, [section, field]] of Object.entries(QUERY_NUM_FIELDS)) {
    const v = finiteNum(q.get(key));
    if (v != null) sections[section][field] = v;
  }

  const name = q.get('name');
  if (name) sections.transmitter.name = name;

  const highRes = q.get('high_res');
  if (highRes != null) sections.simulation.high_resolution = isTruthy(highRes);

  // Enums: only known values pass through (an unknown climate/polarization throws
  // in the engine, an unknown colormap breaks a legend asset); else the default.
  // Own-property checks so inherited keys (`toString`, `constructor`, …) can't slip past the whitelist.
  const climate = q.get('radio_climate');
  if (climate && Object.prototype.hasOwnProperty.call(CLIMATE_CODES, climate)) {
    sections.environment.radio_climate = climate;
  }
  const polarization = q.get('polarization');
  if (polarization && Object.prototype.hasOwnProperty.call(POLARIZATION_CODES, polarization)) {
    sections.environment.polarization = polarization;
  }
  const colorScale = q.get('color_scale');
  if (colorScale && COLORMAP_NAMES.includes(colorScale)) {
    sections.display.color_scale = colorScale;
  }

  const params: Record<string, unknown> = {};
  for (const [section, obj] of Object.entries(sections)) {
    if (Object.keys(obj).length) params[section] = obj;
  }
  return Object.keys(params).length ? params : null;
}

/** True if the URL asks the planner to compute coverage immediately on load
 * (`?run=1` or `#...&run=1`). Ordinary shared permalinks omit it so they don't
 * kick off a heavy simulation unexpectedly. */
export function sharedRunRequested(): boolean {
  if (typeof location === 'undefined') return false;
  if (isTruthy(new URLSearchParams(location.search).get('run'))) return true;
  const hash = location.hash.replace(/^#/, '');
  return hash.split('&').some((p) => {
    const [k, v] = p.split('=');
    return k === 'run' && isTruthy(v);
  });
}

/** Drop the app hand-off query keys from the address bar (no reload) so a
 * refresh doesn't re-import or re-run; unrelated query keys are preserved. */
export function clearSharedQuery(): void {
  if (typeof location === 'undefined' || !location.search) return;
  const q = new URLSearchParams(location.search);
  let changed = false;
  for (const k of QUERY_KEYS) {
    if (q.has(k)) {
      q.delete(k);
      changed = true;
    }
  }
  if (!changed) return;
  const search = q.toString();
  history.replaceState(null, '', location.pathname + (search ? `?${search}` : '') + location.hash);
}
