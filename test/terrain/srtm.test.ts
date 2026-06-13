/* Terrain pipeline parity tests.
 *
 * - tile naming: pure unit tests over hemisphere/meridian edge cases
 * - srtm2sdf transform: golden 1201-grid -> golden SDF values (offline)
 * - downsample: raw S3 tile -> golden 1201 grid (network once, cached
 *   under test/.cache/; skipped automatically when offline)
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

import {
  DOWNSAMPLED_SIZE,
  PAGE_SIZE,
  downsampleAverage,
  pageSignedFloorLon,
  parseHgt,
  srtm2sdfTransform,
  tileNameForPage,
  tileUrls,
} from '../../src/terrain/srtm';
import { FIXTURES, REPO_ROOT } from '../helpers';

const CACHE_DIR = join(REPO_ROOT, 'test', '.cache');

function loadGolden1201(name: string): Int16Array {
  const raw = gunzipSync(readFileSync(join(FIXTURES, 'golden', `${name}_1201_avg_i2le.bin.gz`)));
  return new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
}

/** Parse a SPLAT! SDF text file into page cells (SDF order). */
function loadGoldenSdf(name: string): Int16Array {
  const text = gunzipSync(readFileSync(join(FIXTURES, 'golden', `${name}.sdf.gz`))).toString('ascii');
  const lines = text.split('\n');
  const out = new Int16Array(PAGE_SIZE * PAGE_SIZE);
  for (let i = 0; i < out.length; i++) out[i] = Number(lines[4 + i]);
  return out;
}

describe('tile naming', () => {
  it('maps engine pages to skadi tile names', () => {
    // Calgary region pages (west hemisphere)
    expect(tileNameForPage({ minNorth: 50, minWest: 114 })).toBe('N50W115');
    expect(tileNameForPage({ minNorth: 51, minWest: 113 })).toBe('N51W114');
    // Cape Town (south + east)
    expect(tileNameForPage({ minNorth: -34, minWest: 341 })).toBe('S34E018');
    expect(tileNameForPage({ minNorth: -35, minWest: 341 })).toBe('S35E018');
    // Greenwich meridian pair (London)
    expect(tileNameForPage({ minNorth: 51, minWest: 0 })).toBe('N51W001');
    expect(tileNameForPage({ minNorth: 51, minWest: 359 })).toBe('N51E000');
    // Antimeridian pair (Fiji)
    expect(tileNameForPage({ minNorth: -17, minWest: 179 })).toBe('S17W180');
    expect(tileNameForPage({ minNorth: -17, minWest: 180 })).toBe('S17E179');
  });

  it('signed floor longitudes round-trip', () => {
    expect(pageSignedFloorLon(114)).toBe(-115);
    expect(pageSignedFloorLon(0)).toBe(-1);
    expect(pageSignedFloorLon(359)).toBe(0);
    expect(pageSignedFloorLon(341)).toBe(18);
    expect(pageSignedFloorLon(179)).toBe(-180);
    expect(pageSignedFloorLon(180)).toBe(179);
  });

  it('builds v2-then-v1 URLs', () => {
    expect(tileUrls('N51W115')).toEqual([
      'https://elevation-tiles-prod.s3.amazonaws.com/v2/skadi/N51/N51W115.hgt.gz',
      'https://elevation-tiles-prod.s3.amazonaws.com/skadi/N51/N51W115.hgt.gz',
    ]);
  });
});

describe('srtm2sdf transform', () => {
  for (const [tile, sdf] of [
    ['N51W115', '51:52:114:115'],
    ['N51W001', '51:52:0:1'],
  ] as const) {
    it(`matches backend SDF for ${tile}`, () => {
      const got = srtm2sdfTransform(loadGolden1201(tile));
      const want = loadGoldenSdf(sdf);
      let mismatches = 0;
      for (let i = 0; i < want.length; i++) {
        if (got[i] !== want[i] && mismatches++ < 5) {
          // eslint-disable-next-line no-console
          console.log(`  cell ${i}: got ${got[i]}, want ${want[i]}`);
        }
      }
      expect(mismatches).toBe(0);
    });
  }
});

describe('rasterio average downsample', () => {
  it('matches backend grid for N51W115 (network, cached)', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    const cached = join(CACHE_DIR, 'N51W115.hgt');
    let hgt: Uint8Array;
    if (existsSync(cached)) {
      hgt = readFileSync(cached);
    } else {
      let resp: Response | undefined;
      for (const url of tileUrls('N51W115')) {
        try {
          const r = await fetch(url);
          if (r.ok) {
            resp = r;
            break;
          }
        } catch {
          // offline - skip below
        }
      }
      if (!resp) {
        console.warn('offline: skipping downsample golden test');
        return;
      }
      hgt = gunzipSync(Buffer.from(await resp.arrayBuffer()));
      writeFileSync(cached, hgt);
    }

    const got = downsampleAverage(parseHgt(hgt));
    const want = loadGolden1201('N51W115');

    let exact = 0;
    let within1 = 0;
    let maxDiff = 0;
    for (let i = 0; i < want.length; i++) {
      const d = Math.abs(got[i] - want[i]);
      if (d === 0) exact++;
      if (d <= 1) within1++;
      if (d > maxDiff) maxDiff = d;
    }
    const n = want.length;
    // eslint-disable-next-line no-console
    console.log(
      `downsample: exact ${((exact / n) * 100).toFixed(4)}%, ` +
        `within 1m ${((within1 / n) * 100).toFixed(4)}%, max diff ${maxDiff}m`
    );
    expect(exact / n).toBeGreaterThanOrEqual(0.999);
    expect(maxDiff).toBeLessThanOrEqual(1);
  }, 120000);
});
