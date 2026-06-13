# Testing

## Automated

```bash
pnpm test            # everything below
pnpm test:golden     # wasm engine vs canonical goldens only
```

| Suite | What it proves |
| --- | --- |
| `test/golden/wasm_golden.test.ts` | The WASM engine matches the canonical native-engine goldens (which were validated against the legacy SPLAT! backend's GeoTIFFs): region geometry exact, coverage masks agree within 0.1%, >=99.9% of pixels within +/-1 dB. |
| `test/engine/slices.test.ts` | A sweep split across N workers and merged is **bit-identical** to a single-threaded sweep. |
| `test/terrain/srtm.test.ts` | Tile naming round-trips all hemisphere/meridian edge cases; the browser terrain pipeline reproduces the backend's downsample (within 1 m) and srtm2sdf transform (byte-exact). |
| `test/terrain/service.test.ts` | TerrainService fallback, ocean handling, memoization, concurrency cap. |

Regenerating the canonical engine goldens after an intentional engine change:

```bash
pnpm build:engine:native
/path/to/venv/bin/python scripts/compare_golden.py   # Tier A: native vs legacy GeoTIFFs (needs scripts/requirements-compare.txt)
bash scripts/gen_engine_goldens.sh                   # refresh test/fixtures/golden-engine/
```

## Manual A/B against the legacy service

While the legacy server-side planner is still reachable, compare it with a
local build for each scenario in `test/fixtures/cases/`:

1. `pnpm dev` and open the local planner; open https://site.meshtastic.org in another tab.
2. Enter identical parameters in both (note the case JSONs store power in dBm; the UI takes Watts: 20 dBm = 0.1 W, 27 dBm = 0.5 W).
3. Run both and compare overlays at matching zoom levels.

Expected differences, all intentional:

- **Slightly larger coverage locally.** The legacy backend passed the
  transmitter height to SPLAT! without the meters suffix, so a "2 m" antenna
  was computed as 2 ft. The browser engine converts correctly (2 m = 6.6 ft).
  To reproduce legacy output exactly, set `legacyTxHeightAsFeet: true` in
  `toEngineParams` (see `src/engine/params.ts`).
- **Smoother color gradients.** The legacy GeoTIFF quantized signal to 32
  contour levels and round-tripped colors through grayscale; the browser
  colors the raw dBm grid directly.
- **Display changes are instant locally** (colormap, dBm range, transparency,
  receiver sensitivity at render time); the legacy service baked them into
  the raster.

## Browser smoke checklist

- Default Calgary 30 km run completes with progress bar advancing; overlay
  appears; site listed in the sidebar.
- Cancel mid-run returns to idle without an error.
- Re-running reuses cached terrain (much faster terrain phase; check
  DevTools > Application > Cache Storage > `meshtastic-terrain-v1`).
- 150 km radius (standard mode) completes on a desktop browser.
- Multiple sites overlay together and survive base-layer switches.
- `pnpm build && pnpm preview` (static bundle): all of the above still works.
