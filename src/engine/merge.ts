/* First-touch merge of per-worker rasters.
 *
 * SPLAT! computes a pixel at the FIRST radial that touches it (the mask
 * guard in PlotLRPath skips already-analyzed points). Workers process
 * contiguous slices of the canonical radial order, so merging in
 * ascending slice order with "first set mask wins" reproduces the
 * single-threaded result bit-for-bit: any pixel a later slice computed
 * that an earlier slice also computed is overridden by the earlier
 * slice's value, exactly as the in-process mask would have skipped it.
 */

export interface WorkerRaster {
  signal: Uint8Array;
  mask: Uint8Array;
}

export function mergeFirstTouch(parts: WorkerRaster[], cells: number): WorkerRaster {
  const signal = new Uint8Array(cells);
  const mask = new Uint8Array(cells);
  for (const part of parts) {
    if (part.signal.length !== cells || part.mask.length !== cells)
      throw new Error('worker raster size mismatch');
    for (let i = 0; i < cells; i++) {
      if ((mask[i] & 248) === 0 && (part.mask[i] & 248) !== 0) {
        mask[i] = part.mask[i];
        signal[i] = part.signal[i];
      }
    }
  }
  return { signal, mask };
}

/** Contiguous radial slices, one per worker, covering [0, total). */
export function sliceRadials(total: number, workers: number): { start: number; end: number }[] {
  const n = Math.max(1, Math.min(workers, total));
  const per = Math.ceil(total / n);
  const slices: { start: number; end: number }[] = [];
  for (let start = 0; start < total; start += per)
    slices.push({ start, end: Math.min(start + per, total) });
  return slices;
}
