/* Shared fixture-loading helpers for Node-side (vitest) tests. */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PageRef } from '../src/engine/core';
import type { CoverageRequest } from '../src/engine/params';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = join(REPO_ROOT, 'test', 'fixtures');

export function listCases(): string[] {
  return readdirSync(join(FIXTURES, 'cases'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function loadCase(name: string): CoverageRequest {
  return JSON.parse(
    readFileSync(join(FIXTURES, 'cases', `${name}.json`), 'utf8')
  ) as CoverageRequest;
}

const PAGE_CELLS = 1200 * 1200;
const _pageCache = new Map<string, Int16Array | null>();

/**
 * Terrain page (1200x1200 int16, SDF cell order) for an engine PageRef, or
 * null when no fixture exists (treated as ocean/sea-level by the engine).
 *
 * Derived from the committed `.sdf.gz` fixtures in test/fixtures/terrain/
 * (named minlat:maxlat:minwest:maxwest) rather than pre-unpacked `.s16`
 * blobs, so CI needs no extra setup and the repo stays lean. These are the
 * same SDF files the golden engine output was generated from, so the
 * terrain is byte-identical to what produced the goldens.
 */
export function loadPageData(ref: PageRef): Int16Array | null {
  const maxNorth = ref.minNorth + 1;
  const maxWest = (ref.minWest + 1) % 360; // 359 -> 0 wrap
  const name = `${ref.minNorth}:${maxNorth}:${ref.minWest}:${maxWest}.sdf.gz`;
  if (_pageCache.has(name)) return _pageCache.get(name)!;

  const file = join(FIXTURES, 'terrain', name);
  if (!existsSync(file)) {
    _pageCache.set(name, null);
    return null;
  }
  // SDF: 4 header lines (max_west, min_north, min_west, max_north) then
  // 1200*1200 integer elevation lines in SDF cell order.
  const lines = gunzipSync(readFileSync(file)).toString('ascii').split('\n');
  const page = new Int16Array(PAGE_CELLS);
  for (let i = 0; i < PAGE_CELLS; i++) page[i] = Number(lines[4 + i]);
  _pageCache.set(name, page);
  return page;
}

export interface EngineGolden {
  signal: Uint8Array;
  mask: Uint8Array;
  meta: {
    width: number;
    height: number;
    north: number;
    south: number;
    east: number;
    west: number;
    radials: number;
    pages: number;
    pages_loaded: number;
    itm_errnums: number[];
  };
}

export function loadEngineGolden(name: string): EngineGolden {
  const dir = join(FIXTURES, 'golden-engine');
  return {
    signal: new Uint8Array(gunzipSync(readFileSync(join(dir, `${name}.signal.u8.gz`)))),
    mask: new Uint8Array(gunzipSync(readFileSync(join(dir, `${name}.mask.u8.gz`)))),
    meta: JSON.parse(readFileSync(join(dir, `${name}.meta.json`), 'utf8')),
  };
}
