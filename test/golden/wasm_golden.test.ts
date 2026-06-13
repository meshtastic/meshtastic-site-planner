/* Tier-B golden tests: the WASM engine (running under Node) must match the
 * canonical native-engine goldens, which were themselves validated against
 * the legacy SPLAT! backend's GeoTIFFs (scripts/compare_golden.py).
 *
 * Native (macOS libm) and wasm (emscripten musl libm) differ in the last
 * bits of transcendental functions, so the comparison is tolerance-based:
 *  - region geometry must match exactly,
 *  - coverage masks may disagree on <= 0.1% of pixels,
 *  - >= 99.9% of jointly covered pixels within +/-1 signal unit (1 dB).
 */

import { describe, expect, it } from 'vitest';

import createSplatModule from '../../src/engine/generated/splat_driver.mjs';
import { runCoverageSlice, EngineContext } from '../../src/engine/core';
import { toEngineParams } from '../../src/engine/params';
import { listCases, loadCase, loadPageData, loadEngineGolden } from '../helpers';

const modulePromise = createSplatModule();

describe('wasm engine vs native goldens', () => {
  for (const name of listCases()) {
    it(
      name,
      async () => {
        const m = await modulePromise;
        const params = toEngineParams(loadCase(name), { legacyTxHeightAsFeet: true });

        const ctx = EngineContext.create(m, params);
        const refs = ctx.pages();
        ctx.destroy();
        const pages = refs.map(loadPageData);

        const t0 = performance.now();
        const result = await runCoverageSlice(m, params, pages, { chunk: 256 });
        const elapsed = performance.now() - t0;

        const golden = loadEngineGolden(name);
        expect(result.region.width).toBe(golden.meta.width);
        expect(result.region.height).toBe(golden.meta.height);
        expect(result.region.north).toBeCloseTo(golden.meta.north, 9);
        expect(result.region.south).toBeCloseTo(golden.meta.south, 9);
        expect(result.region.east).toBeCloseTo(golden.meta.east, 9);
        expect(result.region.west).toBeCloseTo(golden.meta.west, 9);
        expect(result.region.radials).toBe(golden.meta.radials);

        const n = golden.meta.width * golden.meta.height;
        let maskMismatch = 0;
        let joint = 0;
        let within1 = 0;
        let maxDiff = 0;
        for (let i = 0; i < n; i++) {
          const a = (golden.mask[i] & 248) !== 0;
          const b = (result.mask[i] & 248) !== 0;
          if (a !== b) {
            maskMismatch++;
            continue;
          }
          if (a && b) {
            joint++;
            const d = Math.abs(golden.signal[i] - result.signal[i]);
            if (d <= 1) within1++;
            if (d > maxDiff) maxDiff = d;
          }
        }

        const maskMismatchFrac = maskMismatch / n;
        const within1Frac = joint > 0 ? within1 / joint : 0;
        // eslint-disable-next-line no-console
        console.log(
          `${name}: ${(elapsed / 1000).toFixed(2)}s wasm, ` +
            `mask mismatch ${(maskMismatchFrac * 100).toFixed(4)}%, ` +
            `within +/-1: ${(within1Frac * 100).toFixed(4)}% of ${joint}, ` +
            `max diff ${maxDiff}`
        );

        expect(maskMismatchFrac).toBeLessThanOrEqual(0.001);
        expect(joint).toBeGreaterThan(0);
        expect(within1Frac).toBeGreaterThanOrEqual(0.999);
      },
      120000
    );
  }
});
