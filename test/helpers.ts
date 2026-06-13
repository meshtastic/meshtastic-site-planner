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

/** Raw .s16 terrain page (SDF cell order) or null when missing (ocean). */
export function loadPageData(ref: PageRef): Int16Array | null {
  const path = join(FIXTURES, 'terrain.s16', `page_${ref.minNorth}_${ref.minWest}.s16`);
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
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
