/* Browser terrain provider: streams SRTM tiles from the AWS Open Data
 * bucket (CORS-enabled), converts them into engine pages, and caches the
 * processed pages (2.88 MB each, ~9x smaller than the source tile and no
 * re-downsampling on revisit) in the Cache API.
 *
 * Missing tiles (open ocean, >60N/56S) resolve to null and are
 * negative-cached; the engine then keeps those pages at sea level, which
 * is exactly what SPLAT! did when an SDF file was absent.
 */

import type { PageRef } from '../engine/core';
import { pageFromHgt, tileNameForPage, tileUrls } from './srtm';

export interface TerrainPageOptions {
  signal?: AbortSignal;
  /** Page resolution: 1200 (90 m, default) or 3600 (30 m HD). */
  ippd?: 1200 | 3600;
}

export interface TerrainProvider {
  getPage(ref: PageRef, opts?: TerrainPageOptions): Promise<Int16Array | null>;
}

export class TerrainError extends Error {
  constructor(public readonly tile: string, message: string, public readonly cause?: unknown) {
    super(`terrain tile ${tile}: ${message}`);
    this.name = 'TerrainError';
  }
}

export interface TerrainServiceOptions {
  /** Cache API bucket name; bump the version suffix to invalidate. */
  cacheName?: string;
  /** Max concurrent tile downloads. */
  concurrency?: number;
  fetchFn?: typeof fetch;
}

const CACHE_KEY_BASE = 'https://elevation-tiles-prod.s3.amazonaws.com/__processed';

export class TerrainService implements TerrainProvider {
  private readonly cacheName: string;
  private readonly fetchFn: typeof fetch;
  private readonly memory = new Map<string, Promise<Int16Array | null>>();

  private readonly maxConcurrent: number;
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(opts: TerrainServiceOptions = {}) {
    this.cacheName = opts.cacheName ?? 'meshtastic-terrain-v1';
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.maxConcurrent =
      opts.concurrency ??
      (typeof navigator !== 'undefined' &&
      (navigator as { deviceMemory?: number }).deviceMemory !== undefined &&
      (navigator as { deviceMemory?: number }).deviceMemory! <= 4
        ? 2
        : 4);
  }

  getPage(ref: PageRef, opts: TerrainPageOptions = {}): Promise<Int16Array | null> {
    const ippd = opts.ippd ?? 1200;
    const key = `page_${ippd}_${ref.minNorth}_${ref.minWest}`;
    let pending = this.memory.get(key);
    if (!pending) {
      pending = this.load(ref, key, ippd, opts.signal);
      this.memory.set(key, pending);
      // Don't memoize failures: a retry should re-attempt the download.
      pending.catch(() => this.memory.delete(key));
    }
    return pending;
  }

  private async load(
    ref: PageRef,
    key: string,
    ippd: 1200 | 3600,
    signal?: AbortSignal
  ): Promise<Int16Array | null> {
    const cacheKey = `${CACHE_KEY_BASE}/v1/${key}.s16`;
    const cache = await this.openCache();

    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        if (hit.headers.get('X-Tile-Missing') === '1') return null;
        const buf = await hit.arrayBuffer();
        if (buf.byteLength === ippd * ippd * 2)
          return new Int16Array(buf);
        await cache.delete(cacheKey); // corrupted entry; refetch
      }
    }

    await this.acquire();
    try {
      const page = await this.download(ref, ippd, signal);
      if (cache) {
        if (page === null) {
          await cache.put(
            cacheKey,
            new Response(null, { headers: { 'X-Tile-Missing': '1' } })
          );
        } else {
          const copy = new Int16Array(page); // fresh ArrayBuffer for the cache
          await cache.put(
            cacheKey,
            new Response(copy.buffer, {
              headers: { 'Content-Type': 'application/octet-stream' },
            })
          );
        }
      }
      return page;
    } finally {
      this.release();
    }
  }

  private async download(
    ref: PageRef,
    ippd: 1200 | 3600,
    signal?: AbortSignal
  ): Promise<Int16Array | null> {
    const tile = tileNameForPage(ref);
    let lastError: unknown;

    for (const url of tileUrls(tile)) {
      let resp: Response;
      try {
        resp = await this.fetchFn(url, { signal });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        lastError = err;
        continue;
      }
      if (resp.status === 404 || resp.status === 403) continue; // try next, else ocean
      if (!resp.ok || !resp.body) {
        lastError = new Error(`HTTP ${resp.status}`);
        continue;
      }
      try {
        const hgt = await new Response(
          resp.body.pipeThrough(new DecompressionStream('gzip'))
        ).arrayBuffer();
        return pageFromHgt(hgt, ippd);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        throw new TerrainError(tile, 'failed to decode', err);
      }
    }

    if (lastError !== undefined)
      throw new TerrainError(tile, 'download failed', lastError);
    return null; // both locations 404: ocean / out of SRTM coverage
  }

  private async openCache(): Promise<Cache | null> {
    if (typeof caches === 'undefined') return null;
    try {
      return await caches.open(this.cacheName);
    } catch {
      return null; // e.g. some private-browsing modes
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.waiters.push(() => {
        this.active++;
        resolve();
      })
    );
  }

  private release(): void {
    this.active--;
    this.waiters.shift()?.();
  }
}
