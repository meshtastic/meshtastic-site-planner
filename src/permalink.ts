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
