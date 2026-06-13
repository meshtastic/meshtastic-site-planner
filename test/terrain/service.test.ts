/* TerrainService behaviour with an injected fetch: v2->v1 fallback,
 * ocean nulls, error propagation, memoization, concurrency cap. */

import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';

import { TerrainService, TerrainError } from '../../src/terrain/TerrainService';
import { HGT_SIZE } from '../../src/terrain/srtm';

function syntheticHgtGz(elevation: number): Uint8Array {
  const grid = new Int16Array(HGT_SIZE * HGT_SIZE).fill(elevation);
  // big-endian
  const bytes = new Uint8Array(grid.length * 2);
  for (let i = 0; i < grid.length; i++) {
    bytes[i * 2] = (grid[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = grid[i] & 0xff;
  }
  return gzipSync(bytes);
}

function fetchStub(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const handler = routes[url];
    if (!handler) return new Response('not found', { status: 404 });
    return handler();
  }) as typeof fetch;
}

const V2 = 'https://elevation-tiles-prod.s3.amazonaws.com/v2/skadi/N51/N51W115.hgt.gz';
const V1 = 'https://elevation-tiles-prod.s3.amazonaws.com/skadi/N51/N51W115.hgt.gz';
const PAGE = { minNorth: 51, minWest: 114 };

describe('TerrainService', () => {
  it('uses the v2 location when available', async () => {
    const gz = syntheticHgtGz(100);
    const svc = new TerrainService({
      fetchFn: fetchStub({ [V2]: () => new Response(gz) }),
    });
    const page = await svc.getPage(PAGE);
    expect(page).not.toBeNull();
    expect(page![0]).toBe(100);
  });

  it('falls back to v1 on 404', async () => {
    const gz = syntheticHgtGz(42);
    let v2Hits = 0;
    const svc = new TerrainService({
      fetchFn: fetchStub({
        [V2]: () => (v2Hits++, new Response('nope', { status: 404 })),
        [V1]: () => new Response(gz),
      }),
    });
    const page = await svc.getPage(PAGE);
    expect(v2Hits).toBe(1);
    expect(page![0]).toBe(42);
  });

  it('returns null (ocean) when both locations 404', async () => {
    const svc = new TerrainService({ fetchFn: fetchStub({}) });
    expect(await svc.getPage(PAGE)).toBeNull();
  });

  it('throws TerrainError on network failure', async () => {
    const svc = new TerrainService({
      fetchFn: (async () => {
        throw new TypeError('network down');
      }) as typeof fetch,
    });
    await expect(svc.getPage(PAGE)).rejects.toBeInstanceOf(TerrainError);
  });

  it('memoizes concurrent requests for the same page', async () => {
    let hits = 0;
    const gz = syntheticHgtGz(7);
    const svc = new TerrainService({
      fetchFn: fetchStub({ [V2]: () => (hits++, new Response(gz)) }),
    });
    const [a, b] = await Promise.all([svc.getPage(PAGE), svc.getPage(PAGE)]);
    expect(hits).toBe(1);
    expect(a).toBe(b);
  });

  it('caps concurrent downloads', async () => {
    let inFlight = 0;
    let peak = 0;
    const gz = syntheticHgtGz(1);
    const svc = new TerrainService({
      concurrency: 2,
      fetchFn: (async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return new Response(gz);
      }) as typeof fetch,
    });
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) => svc.getPage({ minNorth: 40 + i, minWest: 100 }))
    );
    expect(peak).toBeLessThanOrEqual(2);
  });
});
