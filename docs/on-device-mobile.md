# On-Device RF Coverage for the Mobile Apps

**Status: Proposed / Deferred.** This is a design plan, not active work. It
captures how to run the coverage engine natively inside the Meshtastic
Android and iOS apps — offline, with no hosted API — and how to prove it
cheaply when someone picks it up.

## Goal

Let the Meshtastic Android and Apple apps compute RF coverage **on the
device**, offline, reusing the engine the web planner already ships. No
server, no API to host or scale, and provably identical results to the web
app and the original SPLAT! service.

## Why on-device (vs. a hosted API)

- **Offline.** The decisive reason. Meshtastic users plan coverage in
  remote, off-grid places. On-device + cached/pre-downloaded terrain means
  coverage with zero connectivity. An API needs the device online *and*
  able to reach our server — backwards for the field.
- **No server** to run, pay for, scale, secure, or rate-limit.
- **Privacy** — site plans never leave the device.
- **Latency** — local compute, no round-trip. Native ARM beats WASM, and
  native threads share memory (no per-worker page copies the browser
  needs), so a phone is likely *faster* than the web app.
- **Parity for free** — the committed golden fixtures
  ([`test/fixtures/`](../test/fixtures)) are platform-agnostic; a build that
  passes them is provably identical to the web app and to SPLAT!.

A hosted API ([`coverageContours()`](../src/map/contours.ts) over HTTP) is
still a reasonable *option* for thin clients, and the two aren't exclusive
— but on-device should be the primary path for the apps.

## What's already portable (the hard part is done)

[`engine/driver.cpp`](../engine/driver.cpp) + `splat/itwom3.0.cpp`, behind
the C ABI in [`engine/driver.h`](../engine/driver.h), is a self-contained
native library (stdint / math / stdlib / std::vector only). It already
compiles three ways from one source:

- **WASM** — the web app (`src/engine/generated/`).
- **Native CLI** — [`engine/native/main.cpp`](../engine/native/main.cpp),
  used for golden generation. This is the existence proof: the engine
  already builds and runs with a plain native compiler, no Emscripten.
- **Android / iOS** — the same code, two more target triples.

The C ABI is the integration surface (see `driver.h` for exact
signatures): `splat_create` → `splat_load_page` (terrain in) →
`splat_run_radials(start, count)` (resumable, sliceable sweep) →
`splat_rasterize` → `splat_signal_ptr` / `splat_mask_ptr` (the dBm grid
out), plus `splat_region_info` and `splat_destroy`.

## Architecture: one native core + thin per-platform glue

```
            ┌─────────────────────────────────────────────┐
            │   engine core (C++, this repo) — SHARED       │
            │   driver.cpp + itwom3.0.cpp  →  C ABI         │
            └─────────────────────────────────────────────┘
              ▲ JNI shim                  ▲ direct C interop
        ┌─────┴───────┐            ┌──────┴───────┐
        │  Android     │            │  iOS          │
        │  Kotlin      │            │  Swift        │
        │  + terrain   │            │  + terrain    │
        │  + render    │            │  + render     │
        └──────────────┘            └───────────────┘
```

- **Android.** NDK builds the engine to a `.so` per ABI (arm64-v8a,
  armeabi-v7a, x86_64). Kotlin reaches it through a **thin JNI shim** —
  the one bit of glue Android needs, since Java can't call C directly.
  Package as an AAR or wire it into the app's Gradle
  `externalNativeBuild` (CMake).
- **iOS.** clang builds a static lib / XCFramework. **Swift calls the C
  ABI directly** via a bridging header — no shim. Package as a SwiftPM
  binary target or CocoaPod XCFramework.
- **Parallelism.** Run radial slices on a native thread pool (Kotlin
  coroutines / `Executors`; Swift `DispatchQueue` / `TaskGroup`) and merge
  first-touch — same model as the web Worker pool, but threads **share one
  set of elevation pages**, so none of the per-worker copying the browser
  does (it copies only because Web Workers lack shared memory). Lower RAM
  and less overhead on-device.

## Terrain pipeline — the one real decision

The other half is terrain: tile naming, fetch `.hgt.gz`, gunzip,
GDAL-average downsample, and the srtm2sdf transform that produces an engine
page. Today this is ~200 golden-pinned lines of TS in
[`src/terrain/`](../src/terrain) (`srtm.ts` + `TerrainService.ts`).

Two ways to make it native:

1. **Port to Kotlin + Swift** (pragmatic start). Each app fetches/gunzips
   natively (OkHttp + `java.util.zip`; URLSession + `Compression`) and runs
   the transforms. Small, well-documented, and the terrain goldens
   (`test/fixtures/terrain.s16/`, the `*_1201_avg_i2le` downsample goldens)
   verify each port byte-for-byte.
2. **Move it into the C++ engine** (recommended long-term). Add something
   like `splat_make_page(hgt_bytes, len, ippd, out)` so page production is
   shared C++ and **all three platforms — web, Android, iOS — use one
   implementation**. The web app would then call it via WASM, replacing its
   TS terrain. Single source of truth; bytes-in / coverage-out. Bigger
   upfront refactor of working web code, so do it when committing to
   multi-platform.

Recommendation: start with option 1 to ship, plan to converge on option 2.

## Rendering

- **Raster ground overlay (simplest).** Colorize the dBm grid into a bitmap
  and add it as a ground overlay — supported by Google Maps, MapKit, and
  MapLibre Native alike. Mirrors the web app's heatmap.
- **GeoJSON contours.** If the apps use MapLibre Native, the vector
  contours we already built drop in unchanged — port
  [`coverageContours()`](../src/map/contours.ts) (d3-contour /
  marching-squares is portable) or generate them in C++. Crisp at any zoom,
  tappable for signal level, tiny payloads.

## Offline strategy

This is the payoff. Cache processed pages on disk (the native equivalent of
the web app's Cache API), and add a **"download region for offline"**
feature so a user can pre-fetch terrain for an area, then compute coverage
with no connectivity. Basemaps would need their own offline story (MapLibre
Native supports offline tile packs) — separate from coverage, but worth
bundling into the same "download this region" UX.

## Validation — parity comes free

The golden fixtures are platform-agnostic:

- `test/fixtures/golden-engine/` — canonical engine output per scenario.
- `test/fixtures/terrain.s16/`, `*_1201_avg_i2le.bin.gz` — terrain goldens.
- `test/fixtures/golden/*.tif` — the original SPLAT! backend's output.

A native build that reproduces these is provably identical to the web app
and the legacy service. Make "run one fixture case, diff against the
golden" the first native test on each platform; it's the same contract the
web `vitest` golden suite enforces.

## Packaging & CI

- The engine source lives in **this** repo. Either vendor it into each app
  repo (git submodule / subtree) or publish a small native package: an
  **AAR** (Android) and a **SwiftPM XCFramework / CocoaPod** (iOS),
  versioned alongside the WASM artifact so all three stay in lockstep.
- Per-platform CI: an NDK build on Android, `xcodebuild` on iOS, each
  running the golden parity test. Mirrors the existing engine-rebuild +
  golden guard in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Costs & risks (honest)

- The **math is shared and free**; the **plumbing is per-platform** — JNI
  shim (Android), bridging header (iOS), native terrain fetch/cache, native
  render glue, and per-platform build/CI.
- Low-end phones: 30 km standard plots are quick; 150 km or HD are heavier
  but a modern phone handles them (the web app already runs HD on phones).
  Shared-memory threading uses *less* RAM than the web app's per-worker
  copies, which helps.
- Keeping three terrain implementations in sync (option 1) is the main
  drift risk — goldens catch it, and option 2 removes it entirely.

## Phased plan

1. **Proof (½–1 day).** CMake/NDK config + iOS build script that compile
   `driver.cpp` for `arm64`, plus a tiny native test that runs one fixture
   case and diffs against the committed golden. Proves build → call ABI →
   byte-correct coverage. The engine source is already here, so this can
   live in this repo as a reference for the app teams.
2. **Android integration.** JNI shim + Kotlin wrapper, native terrain
   (option 1), thread-pool sweep, raster ground overlay, offline page
   cache, golden parity test.
3. **iOS integration.** Swift/C bridge, mirror of step 2.
4. **Offline UX.** "Download region for offline" (terrain + basemap pack).
5. **Converge terrain to C++** (option 2) and unify the web app onto it.

## Open questions (decide later)

- Which map SDK do the apps use today (Google Maps / MapKit / MapLibre
  Native)? Determines raster-overlay vs. GeoJSON-contour rendering.
- Vendor the engine (submodule) vs. publish packaged artifacts (AAR /
  XCFramework)?
- Terrain: port-per-platform now, or invest in the shared-C++ pipeline up
  front?
- Offline basemap packs — in scope for v1, or coverage-only offline first?

## Related

- [ARCHITECTURE.md](../ARCHITECTURE.md) — how the web app / engine work today.
- [`engine/driver.h`](../engine/driver.h) — the C ABI to integrate against.
- [`engine/native/main.cpp`](../engine/native/main.cpp) — existing native build / golden CLI.
- [`src/terrain/`](../src/terrain), [`src/map/contours.ts`](../src/map/contours.ts) — the terrain + contour logic to port or share.
