/* Shareable permalinks (#9): encode the site parameters into the URL hash so a
 * configured view can be bookmarked or shared. The hash (not the query string)
 * keeps it client-only — no server round-trip — and base64url-encoded JSON
 * keeps arbitrary values safe in a URL. Pure helpers (DOM access is isolated to
 * the small read/build/clear functions) so the codec is unit-testable. */

import type { SplatParams } from './types';

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
 * A minimal, stable query contract so a native app (e.g. the Meshtastic mobile
 * apps) can deep-link into the planner prefilled and, optionally, auto-run —
 * without knowing the internal SplatParams shape or base64-encoding JSON:
 *
 *   ?lat=51.05&lon=-114.07&name=Tower%20A&tx_power=0.5&tx_freq=915&tx_height=12&tx_gain=5.5&run=1
 *
 * Only the keys present are applied (merged over the factory defaults); `run=1`
 * (also accepted in the hash) computes coverage as soon as the map is ready. */

const QUERY_TX_NUMS = ['tx_power', 'tx_freq', 'tx_height', 'tx_gain'] as const;
const QUERY_KEYS = ['lat', 'lon', 'name', ...QUERY_TX_NUMS, 'run'];

function finiteNum(s: string | null): number | null {
  if (s == null || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isTruthy(v: string | null | undefined): boolean {
  return v === '1' || v === 'true';
}

/** Partial params from the flat `?lat=&lon=&name=&tx_*=` query contract, or null
 * if none are present. Shape matches what mergeParams() merges over defaults. */
export function decodeSharedQuery(): unknown | null {
  if (typeof location === 'undefined' || !location.search) return null;
  const q = new URLSearchParams(location.search);
  const tx: Record<string, unknown> = {};
  const lat = finiteNum(q.get('lat'));
  const lon = finiteNum(q.get('lon'));
  if (lat != null) tx.tx_lat = lat;
  if (lon != null) tx.tx_lon = lon;
  const name = q.get('name');
  if (name) tx.name = name;
  for (const k of QUERY_TX_NUMS) {
    const v = finiteNum(q.get(k));
    if (v != null) tx[k] = v;
  }
  return Object.keys(tx).length ? { transmitter: tx } : null;
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
