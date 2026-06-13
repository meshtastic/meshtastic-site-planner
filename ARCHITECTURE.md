# Architecture

The site planner is a **fully static web app**: every part of a coverage
prediction — terrain download, the ITM/Longley-Rice propagation model, and
rendering — runs in the user's browser. There is no backend, queue, or
server-side state. This document describes how.

```
┌────────────────────────────── Browser ───────────────────────────────┐
│                                                                      │
│  Vue UI (src/App.vue, src/components/)                               │
│      │ params                                                        │
│      ▼                                                               │
│  Pinia store (src/store.ts) ── buildCoverageRequest ── toEngineParams│
│      │                                                               │
│      ▼                                                               │
│  WasmCoverageEngine (src/engine/) ───────► coverage.worker.ts × N    │
│      │        ▲                              each: splat_driver.wasm │
│      │        │ signal/mask rasters          (itwom3.0.cpp + driver) │
│      │   first-touch merge                                           │
│      │                                                               │
│      ├──► TerrainService (src/terrain/) ──► AWS elevation-tiles-prod │
│      │        └─ Cache API (processed pages)        (SRTM .hgt.gz)   │
│      ▼                                                               │
│  CoverageResult (Float32 dBm grid + bounds)                          │
│      ▼                                                               │
│  src/map/: crop → colorize → mercator image source → MapLibre GL     │
└──────────────────────────────────────────────────────────────────────┘
```

## The coverage engine

The propagation model is SPLAT!'s ITM (Longley-Rice) implementation —
[`splat/itwom3.0.cpp`](splat/itwom3.0.cpp), **compiled unmodified** — the
same code the legacy server-side service ran. Around it,
[`engine/driver.cpp`](engine/driver.cpp) is a line-faithful port of SPLAT!'s
area-coverage machinery (`splat/splat.cpp`) restructured for in-memory use:

- **Region & pages.** A request expands to a region of whole 1°×1°
  elevation "pages" exactly the way SPLAT!'s `main()` did (`deg_range =
  range_miles / 57`, longitude scaled by `cos(lat)` with the 70° clamp,
  page enumeration in `LoadTopoData` order, including the 0–360
  west-positive longitude convention and antimeridian wraparound). Pages
  are `ippd × ippd` int16 meters; pages without data behave as sea level.
- **Resolution.** `splat_create` takes `resolution_ippd`: 1200 (3-arcsecond
  / ~90 m, the default, like `splat`) or 3600 (1-arcsecond / ~30 m, like
  `splat-hd`). HD uses SPLAT!'s `deg_limit=1.5` and a 16-page cap; the UI
  limits HD to a 30 km radius because pages are 9× larger (~26 MB each).
- **Radial sweep.** Coverage is computed along great-circle radials from
  the transmitter to every perimeter pixel of the region (SPLAT!'s
  `PlotLRMap`/`PlotLRPath`/`ReadPath`). For each path point the ITM model
  evaluates the accumulated terrain profile; received power is derived
  from ERP (`dBm = 10·log10((erp / 10^((loss − 2.14)/10)) · 1000)`) and
  stored as a `uint8` (`200 + round(dBm)`) under a first-touch mask, all
  exactly as SPLAT! does.
- **C ABI.** The wasm module exposes a small handle-based API
  ([`engine/driver.h`](engine/driver.h)): `splat_create` (parameters →
  region), `splat_page_info`/`splat_load_page` (terrain in),
  `splat_run_radials(start, count)` (resumable sweep), `splat_rasterize` +
  `splat_signal_ptr`/`splat_mask_ptr` (rasters out). The radial loop being
  resumable is what lets workers split the sweep and the UI report
  progress and cancel mid-run.

`pnpm build:engine` compiles `driver.cpp + itwom3.0.cpp` with Emscripten
(pinned `emscripten/emsdk` Docker image, no filesystem, ~57 KB wasm) into
[`src/engine/generated/`](src/engine/generated/), which is **committed** so
contributors never need the toolchain. CI rebuilds it and fails on drift.
`engine/native/main.cpp` wraps the same driver as a native CLI for golden
generation.

## Terrain

[`src/terrain/`](src/terrain/) reproduces the legacy backend's terrain
pipeline bit-for-bit (it is pinned by goldens dumped from that backend):

1. Tiles come from the public, CORS-enabled AWS Open Data bucket
   (`elevation-tiles-prod`, skadi layout): `v2/skadi/{N51}/{N51W115}.hgt.gz`
   with a v1 fallback; double-404 means ocean / outside SRTM coverage and
   the page stays at sea level.
2. `DecompressionStream('gzip')` → 3601×3601 big-endian int16.
3. **Standard (90 m):** downsample to 1201×1201 with GDAL-style
   area-weighted averaging (`Resampling.average` semantics, nodata-aware),
   then `srtm2sdf`'s transform → a 1200×1200 page.
   **HD (30 m):** skip the downsample and run `srtm2sdf-hd`'s transform on
   the native 3601² grid → a 3600×3600 page.
   The transform (clamp, below-zero replacement via the sequential
   8-neighbour `average_terrain`, drop the northernmost row and easternmost
   column, SDF cell order) is shared; only the grid size differs.
4. Processed pages (2.88 MB standard, ~26 MB HD) are cached in the Cache
   API (`meshtastic-terrain-v1`, keyed by resolution), so re-runs skip
   download and processing; ocean tiles are negative-cached.

## Worker pool & parallelism

[`WasmCoverageEngine`](src/engine/WasmCoverageEngine.ts) sizes a pool from
`hardwareConcurrency` (capped at 8; halved on low-memory devices, capped at
4 on iOS) and gives each worker a contiguous slice of the canonical radial
order plus its own copy of the pages — **no SharedArrayBuffer**, so the
site needs no cross-origin-isolation headers. Workers run radials in
32-radial chunks, posting progress and checking a cancel flag between
chunks (`AbortSignal` end-to-end).

Merging is **first-touch in ascending slice order** ([merge.ts](src/engine/merge.ts)):
since SPLAT! computes each pixel at the *first* radial that touches it, an
earlier slice's value always wins — making the N-worker result
**bit-identical** to a single-threaded sweep (enforced by test).

## Rendering

The merged result is a Float32 dBm grid (NaN = not computed) with the
region's bounds. [`src/map/overlay.ts`](src/map/overlay.ts) crops it to the
simulation radius and colorizes each pixel from 256-entry
matplotlib-derived LUTs ([colormaps.ts](src/render/colormaps.ts),
regenerated by `scripts/gen_colormap_luts.py`); pixels below the receiver
sensitivity are transparent. Because the raw dBm grid stays in memory,
colormap, range, transparency and sensitivity are pure re-renders — no
recompute.

Two overlay styles, switchable live for all sites (`store.overlayStyle`):

- **Heatmap (raster).** The engine grid is equirectangular (EPSG:4326) but
  MapLibre draws image sources linearly in Web Mercator, so each output row
  is resampled from the source row whose latitude matches that mercator Y.
  The result is a PNG-encoded canvas added as a MapLibre `image` source
  with exact lat/lng corner registration (the reprojection job
  georaster-layer used to do under Leaflet).
- **Contours (vector).** [`src/map/contours.ts`](src/map/contours.ts) runs
  d3-contour over the dBm grid to produce GeoJSON iso-bands ("signal ≥ X
  dBm"), colored from the same LUTs, rendered as MapLibre fill + line
  layers. Crisp at any zoom, a fraction of the bytes, and tappable (click a
  band for its signal level). `coverageContours()` is pure (grid → GeoJSON,
  no MapLibre/DOM) — the exact function a future server/edge API would call
  to return contours to the Android / iOS apps. Large grids are
  block-averaged down before contouring to bound cost and output size.

One source + layer(s) per site, keyed `coverage-<id>`; basemap switches
keep overlays intact (the basemap raster is swapped in place — see
[styles.ts](src/map/styles.ts) — so overlays never need re-adding).

## Validation

The engine's contract is "matches the legacy SPLAT! service", enforced in
tiers (fixtures in [`test/fixtures/`](test/fixtures/), procedure in
[TESTING.md](TESTING.md)):

| Tier | Comparison | Gate |
| --- | --- | --- |
| A | Native driver vs. GeoTIFFs captured from the legacy backend (4 scenarios: Calgary, Cape Town, London/0°, Monterey) | ≥99% pixels within ±1 palette step, ≥99.5% coverage-mask agreement (measured: 100.000% mask agreement on 3/4, 99.999% on the 4th) |
| B | WASM engine (Node/vitest) vs. canonical native goldens | ≥99.9% pixels within ±1 dB, mask mismatch ≤0.1% (measured: 0.0000% mismatch) |
| Invariants | 1-worker vs. N-worker sweeps; terrain transform vs. backend dumps; tile naming edge cases | bit-identical / byte-exact |

Two deliberate deviations from the legacy service are documented in
TESTING.md: the transmitter-height feet/meters bug is fixed (reproducible
via `legacyTxHeightAsFeet` for tests), and gradients are smoother because
colors are no longer quantized to 32 contours.

## UI

The interface implements the
[Meshtastic design standards](https://github.com/meshtastic/design) v1.4
dark scheme: the Material role mapping built from the brand palette
(Neutral `#2C2D3C`, Green `#67EA94`) is defined as CSS custom properties in
[`src/style.css`](src/style.css) and bridged into Bootstrap 5.3's variable
system. System font stack (native-OS familiarity), 16 px body, ≥44 px
touch targets on primary actions, WCAG AA contrast pairings throughout.

The map is **MapLibre GL JS** (GPU-rendered, smooth fractional zoom).
Basemaps ([`src/map/styles.ts`](src/map/styles.ts)) are retina, CDN-backed
raster styles — CARTO Dark Matter (default, matches the theme), Voyager and
Positron, plus Esri hybrids (World Imagery + reference labels, World
Hillshade + labels for terrain context). The map is created with
`preserveDrawingBuffer` so the export control can read the WebGL canvas.
Each simulated site gets a persistent branded pin (inline-SVG Meshtastic
mark, [`src/layers.ts`](src/layers.ts)) anchored at its tip with a
parameter popup; the draft transmitter position pulses until a run
completes. Because markers are bottom-anchored GL-positioned DOM elements,
the pin tip stays locked to its coordinate at every zoom (the old
Leaflet + inline-SVG combo drifted). Controls
([`src/map/controls.ts`](src/map/controls.ts)): zoom, metric scale bar,
geolocate, PNG export, and a basemap switcher, all dark-themed via the same
tokens. A `ResizeObserver` on the container keeps the GL canvas sized when
the layout settles late (e.g. embedded webviews).

## Repository layout

| Path | Purpose |
| --- | --- |
| `engine/` | C++ driver, native CLI, Emscripten build scripts |
| `splat/` | SPLAT! submodule: `itwom3.0.cpp` is compiled into the engine; `splat.cpp` is the reference for the ported sweep |
| `src/engine/` | TS engine API, worker pool, protocol, committed wasm artifacts (`generated/`) |
| `src/terrain/` | Tile naming/fetch, downsample + srtm2sdf transforms (90 m & 30 m), Cache API service |
| `src/map/` | MapLibre basemap styles, coverage overlays (raster `overlay.ts` + vector `contours.ts`), search + custom controls |
| `src/render/` | Colormap LUTs |
| `src/components/` | Parameter panel sections (Vue) |
| `test/` | vitest suites + committed golden fixtures |
| `scripts/` | Golden comparison/generation, colormap LUT generator |
| `.github/workflows/ci.yml` | Engine reproducibility guard, typecheck, tests, build |
