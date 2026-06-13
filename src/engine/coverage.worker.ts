/* Dedicated worker: owns one WASM module instance and computes radial
 * slices of coverage runs on request. */

import createSplatModule from './generated/splat_driver.mjs';
import wasmUrl from './generated/splat_driver.wasm?url';
import type { SplatModule } from './generated/splat_driver.mjs';
import { EngineError, runCoverageSlice } from './core';
import type { FromWorker, ToWorker } from './protocol';

/* Minimal worker-scope surface (the project tsconfig targets the DOM lib,
 * not WebWorker, since this file shares a program with the app). */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

let modulePromise: Promise<SplatModule> | null = null;
const cancelled = new Set<number>();

function getModule(): Promise<SplatModule> {
  modulePromise ??= createSplatModule({ locateFile: () => wasmUrl });
  return modulePromise;
}

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

ctx.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;

  if (msg.type === 'cancel') {
    cancelled.add(msg.runId);
    return;
  }

  if (msg.type !== 'run') return;
  const { runId, params, pages, start, end, chunk } = msg;

  try {
    const m = await getModule();
    const result = await runCoverageSlice(m, params, pages, {
      start,
      end,
      chunk,
      onProgress: (radialsDone) => post({ type: 'progress', runId, radialsDone }),
      shouldCancel: () => cancelled.has(runId),
    });
    cancelled.delete(runId);
    post(
      {
        type: 'done',
        runId,
        signal: result.signal,
        mask: result.mask,
        region: result.region,
        itmWarnings: result.itmWarnings,
      },
      [result.signal.buffer, result.mask.buffer]
    );
  } catch (err) {
    cancelled.delete(runId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      post({ type: 'error', runId, code: 'aborted', message: 'cancelled' });
    } else if (err instanceof EngineError) {
      post({ type: 'error', runId, code: `engine:${err.code}`, message: err.message });
    } else {
      post({
        type: 'error',
        runId,
        code: 'internal',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};

post({ type: 'ready' });
