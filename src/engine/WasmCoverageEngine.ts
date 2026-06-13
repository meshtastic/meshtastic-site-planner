/* Worker-pool WASM implementation of CoverageEngine.
 *
 * The radial sweep is split into contiguous slices, one per worker; each
 * worker computes its slice against its own copy of the elevation pages
 * and returns region-wide signal/mask rasters, merged first-touch in
 * slice order (see merge.ts for why that is bit-identical to a single
 * sweep). No SharedArrayBuffer needed, so the site requires no
 * cross-origin isolation headers.
 */

import createSplatModule from './generated/splat_driver.mjs';
import wasmUrl from './generated/splat_driver.wasm?url';
import type { SplatModule } from './generated/splat_driver.mjs';
import {
  EngineContext,
  type EngineRunParams,
  type LinkResult,
  type LinkTarget,
  type PageRef,
  type RegionInfo,
} from './core';
import type {
  CoverageEngine,
  CoverageProgress,
  CoverageResult,
  CoverageRunOptions,
} from './CoverageEngine';
import { mergeFirstTouch, sliceRadials, type WorkerRaster } from './merge';
import type { DoneMessage, FromWorker, ToWorker } from './protocol';

const RADIAL_CHUNK = 32;

/* Progress is reported as one 0..1 fraction across phases. */
const TERRAIN_SPAN = 0.15;
const COMPUTE_SPAN = 0.83;

/**
 * Peak wasm-heap estimate (MB) for a run. Every worker holds each elevation
 * page (ippd^2 cells * 4 bytes = int16 elevation + signal byte + mask byte)
 * plus a region-wide signal+mask raster (regionCells * 2 bytes).
 */
export function projectedHeapMB(pageCount: number, regionCells: number, ippd: number): number {
  return (pageCount * ippd * ippd * 4 + regionCells * 2) / (1024 * 1024);
}

/**
 * Heap ceiling for a run, under the engine's 1 GB (`MAXIMUM_MEMORY`) limit and
 * leaving room for the sweep's working memory. The page region grows in
 * whole-degree steps, so HD over a large area (high latitude / corner
 * placement) can balloon: a ~9-page region (~667 MB) still runs, but ~12
 * pages (~890 MB) would risk the ceiling, so it is refused.
 */
export const HD_HEAP_BUDGET_MB = 800;

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
}

export function defaultPoolSize(): number {
  if (typeof navigator === 'undefined') return 4;
  let n = Math.min(navigator.hardwareConcurrency || 4, 8);
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (deviceMemory !== undefined && deviceMemory <= 4) n = Math.min(n, 2);
  if (isIOS()) n = Math.min(n, 4);
  return Math.max(1, n);
}

interface PoolWorker {
  worker: Worker;
  handler: ((msg: FromWorker) => void) | null;
}

export interface LinkRunOptions {
  terrain: import('../terrain/TerrainService').TerrainProvider;
  signal?: AbortSignal;
}

function pageKey(ref: PageRef): string {
  return `${ref.minNorth}:${ref.minWest}`;
}

/** West-positive floor longitude, matching splat_create's LoadQTH convention
 * (so a key built here matches a PageRef the engine reports). */
function westPositiveFloor(lonSigned: number): number {
  let wp = lonSigned < 0 ? -lonSigned : 360 - lonSigned;
  if (wp < 0) wp += 360;
  return Math.floor(wp);
}

/** Integer-degree page keys the straight TX->target segment crosses, sampled
 * far finer than the 1-degree page grid so no crossed page is missed. Linear
 * lat/lon interpolation suffices: great-circle vs rhumb divergence is well
 * under a page over LoRa link distances. Antimeridian-spanning links are not
 * handled (vanishingly rare for this use). */
function pagesAlongPath(lat1: number, lon1: number, lat2: number, lon2: number): Set<string> {
  const set = new Set<string>();
  const samples = 512;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const lat = lat1 + (lat2 - lat1) * t;
    const lon = lon1 + (lon2 - lon1) * t;
    set.add(`${Math.floor(lat)}:${westPositiveFloor(lon)}`);
  }
  return set;
}

export class WasmCoverageEngine implements CoverageEngine {
  readonly kind = 'wasm-workers' as const;

  private readonly poolSize: number;
  private workers: PoolWorker[] = [];
  private modulePromise: Promise<SplatModule> | null = null;
  private nextRunId = 1;
  private busy = false;
  private disposed = false;

  constructor(opts: { poolSize?: number } = {}) {
    this.poolSize = Math.max(1, opts.poolSize ?? defaultPoolSize());
  }

  async run(params: EngineRunParams, opts: CoverageRunOptions): Promise<CoverageResult> {
    if (this.disposed) throw new Error('engine disposed');
    if (this.busy) throw new Error('a simulation is already running');
    this.busy = true;
    const started = performance.now();
    try {
      opts.signal?.throwIfAborted();

      /* Enumerate pages/region on the main thread (cheap: no radials). */
      const m = await this.getModule();
      const scout = EngineContext.create(m, params);
      let refs: PageRef[];
      let region: RegionInfo;
      try {
        refs = scout.pages();
        region = scout.region();
      } finally {
        scout.destroy();
      }

      /* OOM guard: fail clearly here, before fetching terrain, rather than
       * aborting the wasm heap mid-run (see projectedHeapMB / HD_HEAP_BUDGET_MB). */
      if (projectedHeapMB(refs.length, region.width * region.height, params.resolutionIppd) > HD_HEAP_BUDGET_MB) {
        throw new Error(
          'This area is too large for high-resolution terrain. ' +
            'Reduce the max range or turn off High resolution terrain.'
        );
      }

      /* Terrain phase. */
      const report = (p: CoverageProgress) => opts.onProgress?.(p);
      let tilesDone = 0;
      const pages = await Promise.all(
        refs.map(async (ref) => {
          const page = await opts.terrain.getPage(ref, {
            signal: opts.signal,
            ippd: params.resolutionIppd,
          });
          tilesDone++;
          report({
            phase: 'terrain',
            completed: tilesDone,
            total: refs.length,
            fraction: (tilesDone / refs.length) * TERRAIN_SPAN,
          });
          return page;
        })
      );
      opts.signal?.throwIfAborted();

      /* Compute phase. Each worker holds its own copy of every page (no
       * SharedArrayBuffer), and during a run the page exists twice per
       * worker (the transferred Int16Array + the wasm-heap copy). Cap the
       * pool so large radii / HD don't exhaust memory: ~2x page bytes x
       * pages x workers must stay under the budget. */
      const perPageMB = (2 * params.resolutionIppd * params.resolutionIppd * 2) / (1024 * 1024);
      const PAGE_MEMORY_BUDGET_MB = 768;
      const memCap = Math.max(1, Math.floor(PAGE_MEMORY_BUDGET_MB / (refs.length * perPageMB)));
      let poolCap = Math.min(this.poolSize, memCap);
      if (params.resolutionIppd === 3600) poolCap = Math.min(poolCap, 4);
      const totalRadials = region.radials;
      const slices = sliceRadials(totalRadials, poolCap);
      const runId = this.nextRunId++;
      const pool = this.ensureWorkers(slices.length);

      const radialsDone = new Array<number>(slices.length).fill(0);
      const reportCompute = () => {
        const done = radialsDone.reduce((a, b) => a + b, 0);
        report({
          phase: 'compute',
          completed: done,
          total: totalRadials,
          fraction: TERRAIN_SPAN + (done / totalRadials) * COMPUTE_SPAN,
        });
      };

      const cancelAll = () => {
        for (const pw of pool) pw.worker.postMessage({ type: 'cancel', runId } satisfies ToWorker);
      };

      const results = await new Promise<DoneMessage[]>((resolve, reject) => {
        const done: (DoneMessage | undefined)[] = new Array(slices.length);
        let remaining = slices.length;
        let settled = false;

        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          cancelAll();
          cleanup();
          reject(err);
        };

        const onAbort = () => fail(new DOMException('aborted', 'AbortError'));
        opts.signal?.addEventListener('abort', onAbort, { once: true });

        const cleanup = () => {
          opts.signal?.removeEventListener('abort', onAbort);
          for (const pw of pool) pw.handler = null;
        };

        slices.forEach((slice, i) => {
          const pw = pool[i];
          pw.handler = (msg: FromWorker) => {
            if (msg.type === 'ready') return;
            // runId -1 = worker-level crash (onerror), fatal for any run.
            if (msg.runId !== runId && !(msg.type === 'error' && msg.runId === -1)) return;
            if (msg.type === 'progress') {
              radialsDone[i] = msg.radialsDone;
              reportCompute();
            } else if (msg.type === 'done') {
              done[i] = msg;
              radialsDone[i] = slice.end - slice.start;
              reportCompute();
              if (--remaining === 0 && !settled) {
                settled = true;
                cleanup();
                resolve(done as DoneMessage[]);
              }
            } else if (msg.type === 'error') {
              fail(
                msg.code === 'aborted'
                  ? new DOMException('aborted', 'AbortError')
                  : new Error(`coverage worker failed (${msg.code}): ${msg.message}`)
              );
            }
          };

          /* Pages are structured-cloned per worker (no transfer): the
           * terrain cache keeps its copies. */
          pw.worker.postMessage({
            type: 'run',
            runId,
            params,
            pages,
            start: slice.start,
            end: slice.end,
            chunk: RADIAL_CHUNK,
          } satisfies ToWorker);
        });
      });

      /* Finalize: merge slices and convert to dBm. */
      report({ phase: 'finalize', completed: 0, total: 1, fraction: TERRAIN_SPAN + COMPUTE_SPAN });
      const cells = region.width * region.height;
      const merged = mergeFirstTouch(
        results.map((r): WorkerRaster => ({ signal: r.signal, mask: r.mask })),
        cells
      );

      const dbm = new Float32Array(cells);
      for (let i = 0; i < cells; i++) {
        dbm[i] = (merged.mask[i] & 248) !== 0 ? merged.signal[i] - 200 : NaN;
      }

      const itmWarnings = [0, 0, 0, 0, 0, 0];
      for (const r of results)
        r.itmWarnings.forEach((v, i) => (itmWarnings[i] += v));

      report({ phase: 'finalize', completed: 1, total: 1, fraction: 1 });

      return {
        dbm,
        width: region.width,
        height: region.height,
        bounds: {
          north: region.north,
          south: region.south,
          east: region.east,
          west: region.west,
        },
        pixelDegrees: 1 / params.resolutionIppd,
        stats: {
          radials: totalRadials,
          pages: refs.length,
          pagesWithData: pages.filter((p) => p !== null).length,
          itmWarnings,
          elapsedMs: performance.now() - started,
          workers: slices.length,
        },
      };
    } finally {
      this.busy = false;
    }
  }

  /**
   * Single point-to-point link query (issue #14). Runs on the main thread
   * (one fast ITM path, no worker pool) and fetches only the terrain pages the
   * TX->target path crosses, so it is cheap even for a long link.
   */
  async runLink(
    params: EngineRunParams,
    target: LinkTarget,
    opts: LinkRunOptions
  ): Promise<LinkResult> {
    if (this.disposed) throw new Error('engine disposed');
    opts.signal?.throwIfAborted();
    const m = await this.getModule();
    const ctx = EngineContext.create(m, params);
    try {
      const refs = ctx.pages();
      const wanted = pagesAlongPath(params.lat, params.lon, target.lat, target.lon);
      const pages = await Promise.all(
        refs.map((ref) =>
          wanted.has(pageKey(ref))
            ? opts.terrain.getPage(ref, {
                signal: opts.signal,
                ippd: params.resolutionIppd,
              })
            : Promise.resolve(null)
        )
      );
      opts.signal?.throwIfAborted();
      for (let i = 0; i < refs.length; i++) {
        const data = pages[i];
        if (data) ctx.loadPage(i, data);
      }
      return ctx.pointToPoint(target.lat, target.lon, target.altFeet);
    } finally {
      ctx.destroy();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const pw of this.workers) pw.worker.terminate();
    this.workers = [];
  }

  private getModule(): Promise<SplatModule> {
    this.modulePromise ??= createSplatModule({ locateFile: () => wasmUrl });
    return this.modulePromise;
  }

  private ensureWorkers(count: number): PoolWorker[] {
    while (this.workers.length < count) {
      const worker = new Worker(new URL('./coverage.worker.ts', import.meta.url), {
        type: 'module',
        name: `coverage-${this.workers.length}`,
      });
      const pw: PoolWorker = { worker, handler: null };
      worker.onmessage = (ev: MessageEvent<FromWorker>) => pw.handler?.(ev.data);
      worker.onerror = (ev) =>
        pw.handler?.({
          type: 'error',
          runId: -1,
          code: 'worker',
          message: ev.message ?? 'worker crashed',
        });
      this.workers.push(pw);
    }
    return this.workers.slice(0, count);
  }
}
