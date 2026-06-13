/* SRTM tile handling: naming, fetching URLs, and the exact transform the
 * legacy backend applied to elevation data before SPLAT! consumed it:
 *
 *   .hgt.gz (3601x3601 big-endian int16, row 0 = north, col 0 = west)
 *     -> gunzip
 *     -> rasterio src.read(out_shape=(1201,1201), Resampling.average)
 *        (app/services/splat.py:706-714)
 *     -> srtm2sdf (splat/utils/srtm2sdf.c): clamp, replace sub-zero cells
 *        via average_terrain(), drop the northernmost row and easternmost
 *        column, and reorder into SDF cell order
 *     -> 1200x1200 int16 "page" consumed by the engine
 *        (data[x][y]: x ascending south->north, y ascending east->west)
 *
 * Every step is replicated bit-for-bit; test/terrain pins this against
 * goldens dumped from the real backend.
 */

import type { PageRef } from '../engine/core';

export const HGT_SIZE = 3601;
export const DOWNSAMPLED_SIZE = 1201;
export const PAGE_SIZE = 1200;
export const SRTM_NODATA = -32768;

const S3_BASE = 'https://elevation-tiles-prod.s3.amazonaws.com';

/** Signed floor longitude of the 1x1 degree cell a page covers. */
export function pageSignedFloorLon(minWest: number): number {
  return minWest < 180 ? -(minWest + 1) : 359 - minWest;
}

/** SRTM/skadi tile name (e.g. N51W115, S34E018) for an engine page. */
export function tileNameForPage(ref: PageRef): string {
  const lat = ref.minNorth;
  const lon = pageSignedFloorLon(ref.minWest);
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  const alat = String(Math.abs(lat)).padStart(2, '0');
  const alon = String(Math.abs(lon)).padStart(3, '0');
  return `${ns}${alat}${ew}${alon}`;
}

/** Candidate download URLs, most preferred first (v2 then v1 skadi). */
export function tileUrls(tileName: string): string[] {
  const dir = tileName.slice(0, 3);
  return [
    `${S3_BASE}/v2/skadi/${dir}/${tileName}.hgt.gz`,
    `${S3_BASE}/skadi/${dir}/${tileName}.hgt.gz`,
  ];
}

/** Parse a raw (decompressed) .hgt into host-endian int16. */
export function parseHgt(bytes: ArrayBuffer | Uint8Array): Int16Array {
  const view =
    bytes instanceof Uint8Array
      ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new DataView(bytes);
  const cells = HGT_SIZE * HGT_SIZE;
  if (view.byteLength < cells * 2)
    throw new Error(`hgt too small: ${view.byteLength} bytes (1-arcsecond tile expected)`);
  const out = new Int16Array(cells);
  for (let i = 0; i < cells; i++) out[i] = view.getInt16(i * 2, false);
  return out;
}

/**
 * GDAL/rasterio Resampling.average decimation, 3601 -> 1201, replicating
 * the area-weighted average GDAL >= 3.3 applies for non-integer ratios,
 * with SRTM nodata (-32768) excluded from the average.
 */
export function downsampleAverage(
  src: Int16Array,
  srcSize = HGT_SIZE,
  dstSize = DOWNSAMPLED_SIZE,
  nodata = SRTM_NODATA
): Int16Array {
  const ratio = srcSize / dstSize;
  const out = new Int16Array(dstSize * dstSize);

  // Precompute per-axis window bounds and edge weights.
  const lo = new Int32Array(dstSize);
  const hi = new Int32Array(dstSize);
  const loW = new Float64Array(dstSize);
  const hiW = new Float64Array(dstSize);
  for (let d = 0; d < dstSize; d++) {
    const start = d * ratio;
    const end = (d + 1) * ratio;
    let s = Math.floor(start);
    let e = Math.ceil(end);
    if (e > srcSize) e = srcSize;
    lo[d] = s;
    hi[d] = e;
    loW[d] = Math.min(s + 1, end) - start; // coverage of first src pixel
    hiW[d] = end - Math.max(e - 1, start); // coverage of last src pixel
  }

  for (let j = 0; j < dstSize; j++) {
    for (let i = 0; i < dstSize; i++) {
      let total = 0;
      let weight = 0;
      for (let y = lo[j]; y < hi[j]; y++) {
        const wy = y === lo[j] ? loW[j] : y === hi[j] - 1 ? hiW[j] : 1;
        const row = y * srcSize;
        for (let x = lo[i]; x < hi[i]; x++) {
          const v = src[row + x];
          if (v === nodata) continue;
          const wx = x === lo[i] ? loW[i] : x === hi[i] - 1 ? hiW[i] : 1;
          const w = wx * wy;
          total += v * w;
          weight += w;
        }
      }
      if (weight === 0) {
        out[j * dstSize + i] = nodata;
      } else {
        const v = total / weight;
        // GDALCopyWords float->int conversion: round half away from zero.
        out[j * dstSize + i] = v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5);
      }
    }
  }
  return out;
}

/**
 * srtm2sdf's WriteSDF (with default min_elevation = 0 and no USGS merge):
 * cells below 0 are replaced in write order by average_terrain() - an
 * 8-neighbour average of values greater than the bad value, mutating the
 * grid as it goes (including its stale-temp fallback when no neighbour
 * qualifies). Emits the page in SDF cell order, dropping the northernmost
 * row and easternmost column.
 *
 * The input is (pageSize+1)^2 row-major with row 0 = north edge:
 * 1201 -> 1200 page for standard resolution (srtm2sdf), or
 * 3601 -> 3600 for HD (srtm2sdf-hd).
 */
export function srtm2sdfTransform(grid: Int16Array, pageSize = PAGE_SIZE): Int16Array {
  const n = pageSize + 1;
  const mpi = pageSize - 1;
  const minElevation = 0;
  const grid1201 = grid;

  if (grid1201.length !== n * n)
    throw new Error(`expected ${n * n} cells, got ${grid1201.length}`);

  // srtm[y][x] in srtm2sdf.c is read with y as the row (north first) and
  // x as the column (west first); clamp exactly like its read loop.
  const srtm = Int32Array.from(grid1201);
  for (let i = 0; i < srtm.length; i++) {
    if (srtm[i] < -32768) srtm[i] = -32768;
    if (srtm[i] > 32767) srtm[i] = 32767;
  }
  const at = (y: number, x: number) => srtm[y * n + x];

  const averageTerrain = (y: number, x: number) => {
    const badValue = at(y, x);
    let accum = 0;
    let count = 0;
    let temp = 0;
    const consider = (yy: number, xx: number) => {
      temp = at(yy, xx);
      if (temp > badValue) {
        accum += temp;
        count++;
      }
    };
    if (y >= 2) consider(y - 1, x);
    if (y <= mpi) consider(y + 1, x);
    if (y >= 2 && x <= mpi - 1) consider(y - 1, x + 1);
    if (x <= mpi - 1) consider(y, x + 1);
    if (x <= mpi - 1 && y <= mpi) consider(y + 1, x + 1);
    if (x >= 1 && y >= 2) consider(y - 1, x - 1);
    if (x >= 1) consider(y, x - 1);
    if (y <= mpi && x >= 1) consider(y + 1, x - 1);
    if (count !== 0) {
      const average = accum / count;
      temp = Math.trunc(average + 0.5);
    }
    srtm[y * n + x] = temp > minElevation ? temp : minElevation;
  };

  const out = new Int16Array(pageSize * pageSize);
  let k = 0;
  // WriteSDF: for (y=ippd; y>=1; y--) for (x=mpi; x>=0; x--)
  for (let y = pageSize; y >= 1; y--) {
    for (let x = mpi; x >= 0; x--) {
      const byte = at(y, x);
      if (byte < minElevation) {
        averageTerrain(y, x);
        out[k++] = at(y, x);
      } else {
        out[k++] = byte;
      }
    }
  }
  return out;
}

/** Full pipeline: decompressed .hgt bytes -> engine page (SDF cell order).
 * ippd 1200 replicates the backend (downsample to 3-arcsec, srtm2sdf);
 * ippd 3600 keeps the native 1-arcsecond data (srtm2sdf-hd). */
export function pageFromHgt(
  hgtBytes: ArrayBuffer | Uint8Array,
  ippd: 1200 | 3600 = 1200
): Int16Array {
  const full = parseHgt(hgtBytes);
  if (ippd === 3600) return srtm2sdfTransform(full, 3600);
  return srtm2sdfTransform(downsampleAverage(full), PAGE_SIZE);
}
