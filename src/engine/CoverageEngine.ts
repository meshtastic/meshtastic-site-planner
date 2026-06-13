/* Public, backend-agnostic coverage engine interface. The WASM worker-pool
 * implementation lives in WasmCoverageEngine.ts; a future WebGPU backend
 * implements this same interface. */

import type { EngineRunParams } from './core';
import type { TerrainProvider } from '../terrain/TerrainService';

export type { EngineRunParams } from './core';
export type { TerrainProvider } from '../terrain/TerrainService';

export interface CoverageProgress {
  phase: 'terrain' | 'compute' | 'finalize';
  completed: number;
  total: number;
  /** Overall 0..1 estimate across phases. */
  fraction: number;
}

export interface CoverageResult {
  /** Received power in dBm, row-major, row 0 = north. NaN = not computed.
   * The receiver-sensitivity threshold is NOT baked in; apply at render. */
  dbm: Float32Array;
  width: number;
  height: number;
  /** Raster bounds in signed degrees (EPSG:4326), as SPLAT! reported them. */
  bounds: { north: number; south: number; east: number; west: number };
  /** Degrees per pixel (1/1200). */
  pixelDegrees: number;
  stats: {
    radials: number;
    pages: number;
    pagesWithData: number;
    /** ITM errnum histogram [0..4, other]; warnings only. */
    itmWarnings: number[];
    elapsedMs: number;
    workers: number;
  };
}

export interface CoverageRunOptions {
  terrain: TerrainProvider;
  signal?: AbortSignal;
  onProgress?: (p: CoverageProgress) => void;
}

export interface CoverageEngine {
  readonly kind: 'wasm-workers' | 'webgpu';
  run(params: EngineRunParams, opts: CoverageRunOptions): Promise<CoverageResult>;
  /** Tear down workers/contexts. The engine is unusable afterwards. */
  dispose(): void;
}
