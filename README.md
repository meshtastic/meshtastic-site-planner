# Meshtastic Site Planner

[![CLA assistant](https://cla-assistant.io/readme/badge/meshtastic/meshtastic-site-planner )](https://cla-assistant.io/meshtastic/meshtastic-site-planner )

## About

To use this tool, go to the official version: https://site.meshtastic.org

This is an online utility for predicting the range of a Meshtastic radio. It creates radio coverage maps using the ITM/Longley-Rice model from the SPLAT! software by John A. Magliacane, KD2BD (https://www.qsl.net/kd2bd/splat.html). The maps are used for planning repeater deployments and for estimating the coverage provided by an existing mesh network. The default parameters have been chosen based on experimental data and practical experience to produce results that are accurate for Meshtastic devices. Model parameters are adjustable, so this tool can also be used for amateur radio projects using different frequencies and higher transmit powers.

**All computation runs locally in your browser.** The ITM propagation model (SPLAT!'s `itwom3.0.cpp`, compiled to WebAssembly) executes across a pool of Web Workers, so there is no server-side compute, no queue, and your site plans never leave your machine. The terrain elevation tiles are streamed directly from AWS Open Data (https://registry.opendata.aws/terrain-tiles/), which are based on the NASA SRTM (Shuttle Radar Topography) dataset (https://www.earthdata.nasa.gov/data/instruments/srtm), and cached by the browser for reuse.


## Usage

The minimal steps for creating a Meshtastic coverage prediction are:

1. Go to the [official version](https://site.meshtastic.org) or run a development copy and open the tool in a web browser. 
2. In `Site Parameters > Site / Transmitter`, enter a name for the site, the geographic coordinates, and the antenna height above ground. Refer to the Meshtastic regional parameters (https://meshtastic.org/docs/configuration/region-by-country/) and input the transmit power, frequency, and antenna gain for your device. 
3. In `Site Parameters > Receiver`, enter the receiver sensitivity (`-130 dBm` for the default `LongFast` channel), the receiver height, and the receiver antenna gain.
4. In `Site Parameters > Simulation Options`, enter the maximum range for the simulation in kilometers (up to 150 km in standard mode). Longer ranges take longer to compute.
5. Press "Run Simulation." Terrain is fetched and the coverage map is computed in your browser — progress is shown, and the run can be cancelled at any time.

Multiple radio sites can be added to the simulation by repeating these steps. For a detailed explanation of the other adjustable parameters, refer to [parameters.md](parameters.md).

## Model and Assumptions

This tool runs a physics simulation that depends on several assumptions. The most important ones are:

1. The SRTM terrain model is accurate to 90 meters by default, or 30 meters when the "High resolution terrain" option is enabled (limited to a 30 km range).
2. There are no obstructions besides terrain that attenuate radio signals. These include trees, artificial structures such as buildings, or transient effects like precipitation.
3. Antennas are isotropic in the horizontal plane (we do not account for directional antennas). 
4. Reflections from the upper atmosphere (skywave propagation) are negligible. This is less accurate when the signal frequency is low (less than approximately 50 MHz). 

A detailed description of the model parameters and their recommended values is available in [parameters.md](parameters.md).

## How it works

Everything runs client-side: terrain tiles stream from AWS Open Data, the
ITM model (compiled to WebAssembly from SPLAT!'s sources) sweeps radials
across a Web Worker pool, and the resulting dBm grid is drawn on a
GPU-accelerated MapLibre GL map — either as a color heatmap or as tappable
vector signal contours (GeoJSON). The full technical description — engine,
terrain pipeline (90 m and 30 m), parallelization, rendering, and the
golden-fixture validation against the legacy server — is in
[ARCHITECTURE.md](ARCHITECTURE.md), with test procedures in
[TESTING.md](TESTING.md).

The interface follows the [Meshtastic design standards](https://github.com/meshtastic/design)
(v1.4 dark scheme tokens, WCAG AA contrast, 44 px touch targets); the
theme lives in [src/style.css](src/style.css).

## Building

Requirements:

- Git
- Node.js 20+ and pnpm

```bash
git clone --recurse-submodules https://github.com/meshtastic/meshtastic-site-planner && cd meshtastic-site-planner

pnpm i        # install dependencies
pnpm dev      # development server
pnpm build    # production build (static site in dist/)
pnpm test     # golden-parity, terrain, and engine tests
```

The output in `dist/` is a fully static site; host it on any web server or CDN.

### Deployment (GitHub Pages)

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds the site and publishes it to GitHub Pages on every push to `main`. The build uses relative asset paths (`base: './'`), so it works unchanged at the default project URL (`…github.io/meshtastic-site-planner/`) or at a custom domain root.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. The next push to `main` (or a manual run of the workflow) deploys.

To serve it at `site.meshtastic.org`: add a `public/CNAME` file containing `site.meshtastic.org`, then point that DNS record (CNAME → `meshtastic.github.io`) when you're ready to cut over. Until then it's reachable at the default project URL.

Alternatively, `docker compose up --build` builds the same `dist/` into an nginx container (the previous self-hosted setup).

### The coverage engine

The RF engine is SPLAT!'s ITM/Longley-Rice implementation (`splat/itwom3.0.cpp`, unmodified) plus a small driver ([engine/driver.cpp](engine/driver.cpp)) that ports SPLAT!'s area-coverage sweep to run on in-memory terrain, compiled to WebAssembly. The compiled artifacts are committed in `src/engine/generated/`, so building the site does **not** require Emscripten. To rebuild the engine after changing `engine/` or the `splat/` submodule:

```bash
pnpm build:engine          # reproducible build via the pinned emscripten/emsdk Docker image
pnpm build:engine:local    # or use an em++ from your PATH
```

CI rebuilds the engine and fails if the committed artifacts differ from the source.

### Validation

The engine is validated against golden outputs captured from the legacy server-side SPLAT! backend before it was removed (`test/fixtures/`): four scenarios across hemispheres and the prime meridian, plus terrain-pipeline goldens. `pnpm test` checks the WASM engine against these within a +/-1 dB tolerance and verifies that worker-parallel sweeps are bit-identical to single-threaded ones. See [test/fixtures/generate.sh](test/fixtures/generate.sh) for how the fixtures were produced.
