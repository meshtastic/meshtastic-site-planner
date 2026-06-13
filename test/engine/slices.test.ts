/* Worker-parallelism invariants, run in-process via core.ts (no real
 * Web Workers needed):
 *
 *  - sliceRadials covers [0, total) exactly, in order, without overlap
 *  - a sweep split into N slices and merged first-touch is BIT-IDENTICAL
 *    to the full single-context sweep (the parallel-correctness claim)
 */

import { describe, expect, it } from 'vitest';

import createSplatModule from '../../src/engine/generated/splat_driver.mjs';
import { EngineContext, runCoverageSlice } from '../../src/engine/core';
import { toEngineParams } from '../../src/engine/params';
import { mergeFirstTouch, sliceRadials } from '../../src/engine/merge';
import { loadCase, loadPageData } from '../helpers';

const modulePromise = createSplatModule();

describe('sliceRadials', () => {
  it('partitions exactly', () => {
    for (const [total, workers] of [
      [9600, 8],
      [7, 8],
      [1, 1],
      [9601, 4],
    ] as const) {
      const slices = sliceRadials(total, workers);
      expect(slices[0].start).toBe(0);
      expect(slices[slices.length - 1].end).toBe(total);
      for (let i = 1; i < slices.length; i++)
        expect(slices[i].start).toBe(slices[i - 1].end);
    }
  });
});

describe('slice merge invariance', () => {
  it('london_15km: 4 merged slices == full sweep (bit-identical)', async () => {
    const m = await modulePromise;
    const params = toEngineParams(loadCase('london_15km'), { legacyTxHeightAsFeet: true });

    const ctx = EngineContext.create(m, params);
    const refs = ctx.pages();
    ctx.destroy();
    const pages = refs.map(loadPageData);

    const full = await runCoverageSlice(m, params, pages, { chunk: 512 });

    const slices = sliceRadials(full.region.radials, 4);
    const parts = [];
    for (const s of slices)
      parts.push(
        await runCoverageSlice(m, params, pages, { start: s.start, end: s.end, chunk: 512 })
      );

    const cells = full.region.width * full.region.height;
    const merged = mergeFirstTouch(parts, cells);

    expect(Buffer.from(merged.mask).equals(Buffer.from(full.mask))).toBe(true);
    expect(Buffer.from(merged.signal).equals(Buffer.from(full.signal))).toBe(true);
  }, 120000);
});
