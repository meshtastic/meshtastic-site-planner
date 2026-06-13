/* Thin, allocation-careful wrapper around the WASM coverage engine.
 * Runs identically in Web Workers and in Node (vitest golden tests). */

import type { SplatModule } from './generated/splat_driver.mjs';

export interface EngineRunParams {
  /** Transmitter location, WGS84 signed degrees. */
  lat: number;
  lon: number;
  /** Antenna heights in feet AGL (see params.ts for the legacy quirk). */
  txAltFeet: number;
  rxAltFeet: number;
  frequencyMhz: number;
  erpWatts: number;
  groundDielectric: number;
  groundConductivity: number;
  atmosphereBending: number;
  /** SPLAT! climate code 1-7 (see CLIMATE_CODES). */
  radioClimate: number;
  /** 0 horizontal, 1 vertical. */
  polarization: 0 | 1;
  /** Situation/time fractions in (0, 1]. */
  conf: number;
  rel: number;
  clutterHeightM: number;
  radiusKm: number;
  /** Terrain resolution: 1200 px/deg (90 m) or 3600 px/deg (30 m HD). */
  resolutionIppd: 1200 | 3600;
}

export interface PageRef {
  /** Page SW corner: floor latitude (degrees north). */
  minNorth: number;
  /** Floor longitude in SPLAT!'s west-positive 0-359 convention. */
  minWest: number;
}

export interface RegionInfo {
  width: number;
  height: number;
  /** KML LatLonBox bounds (signed degrees) as SPLAT! reports them. */
  north: number;
  south: number;
  east: number;
  west: number;
  radials: number;
  pages: number;
}

export interface LinkTarget {
  /** Target (receiver) location, WGS84 signed degrees. */
  lat: number;
  lon: number;
  /** Receiver antenna height in feet AGL. */
  altFeet: number;
}

export interface LinkProfilePoint {
  /** Distance from the transmitter along the great circle, km. */
  distanceKm: number;
  /** Ground elevation, meters (no clutter). */
  groundM: number;
}

export interface LinkResult {
  /** ITM path loss, dB. */
  lossDb: number;
  /** Received signal at the target, dBm (TX gain via ERP; RX gain excluded). */
  dbm: number;
  distanceKm: number;
  azimuthDeg: number;
  /** ITM mode error number (>0 = caution; warning only). */
  itmErrno: number;
  profile: LinkProfilePoint[];
}

/** Cells per elevation page at a given resolution. */
export function pageCells(ippd: number): number {
  return ippd * ippd;
}

const ENGINE_ERRORS: Record<number, string> = {
  [-1]: 'out of memory',
  [-2]: 'bad handle',
  [-3]: 'bad page',
  [-4]: 'coverage region too large',
  [-5]: 'invalid parameters',
};

export class EngineError extends Error {
  constructor(public readonly code: number, what: string) {
    super(`${what}: ${ENGINE_ERRORS[code] ?? `engine error ${code}`}`);
    this.name = 'EngineError';
  }
}

function check(rc: number, what: string): number {
  if (rc < 0) throw new EngineError(rc, what);
  return rc;
}

/** One coverage computation (wraps an engine handle). */
export class EngineContext {
  private constructor(
    private readonly m: SplatModule,
    private handle: number,
    readonly ippd: number
  ) {}

  static create(m: SplatModule, p: EngineRunParams): EngineContext {
    const h = m._splat_create(
      p.lat,
      p.lon,
      p.txAltFeet,
      p.rxAltFeet,
      p.frequencyMhz,
      p.erpWatts,
      p.groundDielectric,
      p.groundConductivity,
      p.atmosphereBending,
      p.radioClimate,
      p.polarization,
      p.conf,
      p.rel,
      p.clutterHeightM,
      p.radiusKm,
      p.resolutionIppd
    );
    check(h, 'splat_create');
    return new EngineContext(m, h, p.resolutionIppd);
  }

  pages(): PageRef[] {
    const count = check(this.m._splat_page_count(this.handle), 'splat_page_count');
    const out = this.m._splat_malloc(8);
    try {
      const refs: PageRef[] = [];
      for (let i = 0; i < count; i++) {
        check(this.m._splat_page_info(this.handle, i, out), 'splat_page_info');
        const base = out >> 2;
        refs.push({
          minNorth: this.m.HEAP32[base],
          minWest: this.m.HEAP32[base + 1],
        });
      }
      return refs;
    } finally {
      this.m._splat_free(out);
    }
  }

  loadPage(index: number, data: Int16Array): void {
    const cells = pageCells(this.ippd);
    if (data.length !== cells)
      throw new Error(`page ${index}: expected ${cells} cells, got ${data.length}`);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const ptr = this.m._splat_malloc(bytes.length);
    if (!ptr) throw new EngineError(-1, 'splat_malloc');
    try {
      this.m.HEAPU8.set(bytes, ptr);
      check(this.m._splat_load_page(this.handle, index, ptr), 'splat_load_page');
    } finally {
      this.m._splat_free(ptr);
    }
  }

  radialCount(): number {
    return check(this.m._splat_radial_count(this.handle), 'splat_radial_count');
  }

  /** Runs radials [start, start+count); returns how many actually ran. */
  runRadials(start: number, count: number): number {
    return check(this.m._splat_run_radials(this.handle, start, count), 'splat_run_radials');
  }

  rasterize(): void {
    check(this.m._splat_rasterize(this.handle), 'splat_rasterize');
  }

  region(): RegionInfo {
    const out = this.m._splat_malloc(8 * 8);
    try {
      check(this.m._splat_region_info(this.handle, out), 'splat_region_info');
      const base = out >> 3;
      const v = this.m.HEAPF64;
      return {
        width: v[base],
        height: v[base + 1],
        north: v[base + 2],
        south: v[base + 3],
        east: v[base + 4],
        west: v[base + 5],
        radials: v[base + 6],
        pages: v[base + 7],
      };
    } finally {
      this.m._splat_free(out);
    }
  }

  /** Copies the region-wide signal raster out of the wasm heap. */
  signal(width: number, height: number): Uint8Array {
    const ptr = this.m._splat_signal_ptr(this.handle);
    if (!ptr) throw new Error('signal raster not available (rasterize first)');
    return this.m.HEAPU8.slice(ptr, ptr + width * height);
  }

  mask(width: number, height: number): Uint8Array {
    const ptr = this.m._splat_mask_ptr(this.handle);
    if (!ptr) throw new Error('mask raster not available (rasterize first)');
    return this.m.HEAPU8.slice(ptr, ptr + width * height);
  }

  errnumCounts(): number[] {
    const out = this.m._splat_malloc(6 * 4);
    try {
      check(this.m._splat_errnum_counts(this.handle, out), 'splat_errnum_counts');
      const base = out >> 2;
      return Array.from(this.m.HEAP32.subarray(base, base + 6));
    } finally {
      this.m._splat_free(out);
    }
  }

  /**
   * Single TX->target link analysis (issue #14): the same ITM model the
   * coverage sweep uses, over the full great-circle profile to one point.
   * Does not touch the page rasters, so it is safe before or after a sweep.
   * Terrain pages the path crosses must be loaded first (unloaded = sea level).
   */
  pointToPoint(dstLatDeg: number, dstLonDeg: number, dstAltFeet: number): LinkResult {
    const out = this.m._splat_malloc(5 * 8);
    if (!out) throw new EngineError(-1, 'splat_malloc');
    try {
      const n = check(
        this.m._splat_point_to_point(this.handle, dstLatDeg, dstLonDeg, dstAltFeet, out),
        'splat_point_to_point'
      );
      // Re-read the heap view: the call may have grown wasm memory.
      let v = this.m.HEAPF64;
      const base = out >> 3;
      const result: LinkResult = {
        lossDb: v[base],
        dbm: v[base + 1],
        distanceKm: v[base + 2],
        azimuthDeg: v[base + 3],
        itmErrno: v[base + 4],
        profile: [],
      };
      const pptr = this.m._splat_p2p_profile_ptr(this.handle);
      if (pptr) {
        v = this.m.HEAPF64;
        const pb = pptr >> 3;
        for (let i = 0; i < n; i++)
          result.profile.push({ distanceKm: v[pb + 2 * i], groundM: v[pb + 2 * i + 1] });
      }
      return result;
    } finally {
      this.m._splat_free(out);
    }
  }

  /**
   * Highest terrain point within radiusKm of the TX (issue #39). Returns the
   * signed lat/lon and elevation (m); equals the TX when nothing nearby is
   * higher. Pages covering the search disk must be loaded first.
   */
  highpoint(radiusKm: number): { lat: number; lon: number; elevationM: number } {
    const out = this.m._splat_malloc(3 * 8);
    if (!out) throw new EngineError(-1, 'splat_malloc');
    try {
      check(this.m._splat_highpoint(this.handle, radiusKm, out), 'splat_highpoint');
      const v = this.m.HEAPF64;
      const base = out >> 3;
      return { lat: v[base], lon: v[base + 1], elevationM: v[base + 2] };
    } finally {
      this.m._splat_free(out);
    }
  }

  destroy(): void {
    if (this.handle > 0) {
      this.m._splat_destroy(this.handle);
      this.handle = 0;
    }
  }
}

/** Fast macrotask yield (MessageChannel beats setTimeout's clamping). */
const yieldToEventLoop = (() => {
  if (typeof MessageChannel === 'undefined')
    return () => new Promise<void>((r) => setTimeout(r, 0));
  const channel = new MessageChannel();
  let pending: (() => void) | null = null;
  channel.port1.onmessage = () => {
    const r = pending;
    pending = null;
    r?.();
  };
  return () =>
    new Promise<void>((resolve) => {
      pending = resolve;
      channel.port2.postMessage(null);
    });
})();

export interface RunSliceResult {
  signal: Uint8Array;
  mask: Uint8Array;
  region: RegionInfo;
  itmWarnings: number[];
}

export interface RunSliceOptions {
  /** Radial slice [start, end); defaults to the full sweep. */
  start?: number;
  end?: number;
  /** Radials per splat_run_radials call (progress/cancel granularity). */
  chunk?: number;
  onProgress?: (radialsDone: number, radialsTotal: number) => void;
  /** Checked between chunks; return true to abort. */
  shouldCancel?: () => boolean;
}

/**
 * Run a radial slice of one coverage computation in this context and
 * return the rasterized signal/mask grids. Pages must map 1:1 to the
 * engine's page list (null = no data / ocean).
 */
export async function runCoverageSlice(
  m: SplatModule,
  params: EngineRunParams,
  pageData: (Int16Array | null)[],
  opts: RunSliceOptions = {}
): Promise<RunSliceResult> {
  const ctx = EngineContext.create(m, params);
  try {
    const refs = ctx.pages();
    if (pageData.length !== refs.length)
      throw new Error(`expected ${refs.length} pages, got ${pageData.length}`);
    for (let i = 0; i < refs.length; i++) {
      const data = pageData[i];
      if (data) ctx.loadPage(i, data);
    }

    const total = ctx.radialCount();
    const start = opts.start ?? 0;
    const end = Math.min(opts.end ?? total, total);
    const chunk = Math.max(1, opts.chunk ?? 32);

    for (let at = start; at < end; ) {
      if (opts.shouldCancel?.()) throw new DOMException('aborted', 'AbortError');
      const ran = ctx.runRadials(at, Math.min(chunk, end - at));
      at += ran;
      opts.onProgress?.(at - start, end - start);
      // Yield a macrotask so worker message handlers (cancel) can run;
      // a microtask yield would never let onmessage fire.
      if (at < end) await yieldToEventLoop();
    }

    ctx.rasterize();
    const region = ctx.region();
    return {
      signal: ctx.signal(region.width, region.height),
      mask: ctx.mask(region.width, region.height),
      region,
      itmWarnings: ctx.errnumCounts(),
    };
  } finally {
    ctx.destroy();
  }
}
