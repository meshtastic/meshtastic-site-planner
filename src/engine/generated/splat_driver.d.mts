/* Hand-written typings for the Emscripten-generated module
 * (engine/build.sh -> splat_driver.mjs/.wasm). Keep in sync with
 * engine/driver.h and engine/exports.json. */

export interface SplatModule {
  _splat_create(
    txLatDeg: number,
    txLonDeg: number,
    txAltFeet: number,
    rxAltFeet: number,
    frequencyMhz: number,
    erpWatts: number,
    epsDielect: number,
    sgmConductivity: number,
    enoNsSurfref: number,
    radioClimate: number,
    polarization: number,
    conf: number,
    rel: number,
    clutterHeightM: number,
    radiusKm: number,
    resolutionIppd: number
  ): number;
  _splat_page_count(handle: number): number;
  _splat_page_info(handle: number, index: number, outPtr: number): number;
  _splat_load_page(handle: number, index: number, dataPtr: number): number;
  _splat_radial_count(handle: number): number;
  _splat_run_radials(handle: number, start: number, count: number): number;
  _splat_rasterize(handle: number): number;
  _splat_region_info(handle: number, outPtr: number): number;
  _splat_signal_ptr(handle: number): number;
  _splat_mask_ptr(handle: number): number;
  _splat_errnum_counts(handle: number, outPtr: number): number;
  _splat_destroy(handle: number): void;
  _splat_malloc(bytes: number): number;
  _splat_free(ptr: number): void;

  /* Live heap views; re-read after any call that may grow memory. */
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPF64: Float64Array;
}

export interface SplatModuleOptions {
  locateFile?: (path: string, prefix: string) => string;
}

declare function createSplatModule(
  options?: SplatModuleOptions
): Promise<SplatModule>;

export default createSplatModule;
