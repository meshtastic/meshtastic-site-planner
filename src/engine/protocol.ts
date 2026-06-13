/* Messages between WasmCoverageEngine and coverage.worker.ts. */

import type { EngineRunParams, RegionInfo } from './core';

export interface RunRequest {
  type: 'run';
  runId: number;
  params: EngineRunParams;
  /** Page elevation data aligned with the engine's page list; null = ocean.
   * Int16Arrays are transferred, one copy per worker. */
  pages: (Int16Array | null)[];
  /** Radial slice [start, end) this worker computes. */
  start: number;
  end: number;
  /** Radials per wasm call (progress/cancel granularity). */
  chunk: number;
}

export interface CancelRequest {
  type: 'cancel';
  runId: number;
}

export type ToWorker = RunRequest | CancelRequest;

export interface ReadyMessage {
  type: 'ready';
}

export interface ProgressMessage {
  type: 'progress';
  runId: number;
  radialsDone: number;
}

export interface DoneMessage {
  type: 'done';
  runId: number;
  signal: Uint8Array;
  mask: Uint8Array;
  region: RegionInfo;
  itmWarnings: number[];
}

export interface ErrorMessage {
  type: 'error';
  runId: number;
  code: string;
  message: string;
}

export type FromWorker = ReadyMessage | ProgressMessage | DoneMessage | ErrorMessage;
