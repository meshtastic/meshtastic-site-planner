/* HD (1-arcsecond / 30 m) mode checks.
 *
 * Cheap by default: region/page enumeration and parameter mapping for
 * resolutionIppd=3600. The full HD compute smoke test (single page,
 * ~10 km radius) is heavy and runs only with RUN_HD_TEST=1.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import createSplatModule from '../../src/engine/generated/splat_driver.mjs';
import { EngineContext, runCoverageSlice, type EngineRunParams } from '../../src/engine/core';
import { toEngineParams } from '../../src/engine/params';
import { projectedHeapMB, HD_HEAP_BUDGET_MB } from '../../src/engine/WasmCoverageEngine';
import { pageFromHgt } from '../../src/terrain/srtm';
import { REPO_ROOT } from '../helpers';
import { loadCase } from '../helpers';

const modulePromise = createSplatModule();

function hdParams(lat: number, lon: number, radiusKm: number): EngineRunParams {
  const req = loadCase('calgary_30km');
  return {
    ...toEngineParams(req, { legacyTxHeightAsFeet: true }),
    lat,
    lon,
    radiusKm,
    resolutionIppd: 3600,
  };
}

describe('hd mode', () => {
  it('toEngineParams maps high_resolution and clamps the radius', () => {
    const req = { ...loadCase('calgary_30km'), high_resolution: true, radius: 100000 };
    const p = toEngineParams(req);
    expect(p.resolutionIppd).toBe(3600);
    expect(p.radiusKm).toBe(70); // HD cap (70 km)
    // A radius under the cap is left untouched.
    expect(toEngineParams({ ...loadCase('calgary_30km'), high_resolution: true, radius: 50000 }).radiusKm).toBe(50);
    expect(toEngineParams(loadCase('calgary_30km')).resolutionIppd).toBe(1200);
  });

  it('heap guard refuses a too-large HD region but allows typical ones', () => {
    // A 12-page HD region (high-latitude / corner placement) projects ~890 MB.
    expect(projectedHeapMB(12, 10800 * 14400, 3600)).toBeGreaterThan(HD_HEAP_BUDGET_MB);
    // A typical 8-page HD region (~593 MB) and a 9-page worst-mid-lat (~667 MB) run.
    expect(projectedHeapMB(8, 7200 * 14400, 3600)).toBeLessThan(HD_HEAP_BUDGET_MB);
    expect(projectedHeapMB(9, 10800 * 10800, 3600)).toBeLessThan(HD_HEAP_BUDGET_MB);
    // Standard resolution never trips the guard (a large 150 km region).
    expect(projectedHeapMB(32, 9600 * 4800, 1200)).toBeLessThan(HD_HEAP_BUDGET_MB);
  });

  it('engine enumerates the same pages at 3600 ippd with HD-sized grids', async () => {
    const m = await modulePromise;
    const sd = EngineContext.create(m, {
      ...hdParams(51.5, -114.5, 10),
      resolutionIppd: 1200,
    });
    const hd = EngineContext.create(m, hdParams(51.5, -114.5, 10));
    try {
      expect(hd.pages()).toEqual(sd.pages()); // page layout independent of resolution
      const sdRegion = sd.region();
      const hdRegion = hd.region();
      expect(hdRegion.width).toBe(sdRegion.width * 3);
      expect(hdRegion.height).toBe(sdRegion.height * 3);
      expect(hdRegion.radials).toBe(sdRegion.radials * 3);
      // Bounds north differs by the half... pixel offset (dpp differs).
      expect(hdRegion.south).toBe(sdRegion.south);
      expect(hdRegion.west).toBe(sdRegion.west);
    } finally {
      sd.destroy();
      hd.destroy();
    }
  });

  it.runIf(process.env.RUN_HD_TEST === '1')(
    'computes a single-page HD viewshed (heavy)',
    async () => {
      const cached = join(REPO_ROOT, 'test', '.cache', 'N51W115.hgt');
      expect(existsSync(cached)).toBe(true); // produced by the terrain test
      const hgt = readFileSync(cached);
      const page = pageFromHgt(hgt, 3600);
      expect(page.length).toBe(3600 * 3600);

      const m = await modulePromise;
      const params = hdParams(51.5, -114.5, 10);
      const result = await runCoverageSlice(m, params, [page], { chunk: 1024 });
      expect(result.region.width).toBe(3600);
      let covered = 0;
      for (let i = 0; i < result.mask.length; i++)
        if ((result.mask[i] & 248) !== 0) covered++;
      expect(covered).toBeGreaterThan(1000);
    },
    600000
  );
});
