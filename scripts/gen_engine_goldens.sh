#!/usr/bin/env bash
# Generate canonical engine goldens (Tier A output of the native CLI) used
# by the wasm golden tests (Tier B). Run scripts/compare_golden.py first to
# populate test/fixtures/terrain.s16/ and to validate the native engine
# against the legacy backend's GeoTIFFs.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

CLI=engine/build/splat_cli
OUT_DIR=test/fixtures/golden-engine
PAGES_DIR=test/fixtures/terrain.s16

[[ -x "$CLI" ]] || { echo "build the CLI first: bash engine/build_native.sh"; exit 1; }
[[ -d "$PAGES_DIR" ]] || { echo "run scripts/compare_golden.py first to unpack terrain"; exit 1; }

mkdir -p "$OUT_DIR"

python3 - <<'EOF'
import json, math, os, subprocess, gzip, shutil, time

CLIMATE = {"equatorial":1,"continental_subtropical":2,"maritime_subtropical":3,
           "desert":4,"continental_temperate":5,"maritime_temperate_land":6,
           "maritime_temperate_sea":7}
POL = {"horizontal":0,"vertical":1}

for f in sorted(os.listdir("test/fixtures/cases")):
    if not f.endswith(".json"):
        continue
    name = f[:-5]
    case = json.load(open(f"test/fixtures/cases/{f}"))
    erp = 10 ** ((case["tx_power"] + case["tx_gain"] - case["system_loss"] - 30) / 10)
    out = f"test/fixtures/golden-engine/{name}"
    args = ["engine/build/splat_cli",
            "--lat", str(case["lat"]), "--lon", str(case["lon"]),
            "--txft", str(case["tx_height"]),               # legacy feet quirk
            "--rxft", str(case["rx_height"] / 0.3048),
            "--freq", str(case["frequency_mhz"]),
            "--erp", f"{erp:.2f}",
            "--dielect", str(case["ground_dielectric"]),
            "--cond", str(case["ground_conductivity"]),
            "--bend", str(case["atmosphere_bending"]),
            "--climate", str(CLIMATE[case["radio_climate"]]),
            "--pol", str(POL[case["polarization"]]),
            "--conf", f"{case['situation_fraction']/100.0:.2f}",
            "--rel", f"{case['time_fraction']/100.0:.2f}",
            "--clutter-m", str(case["clutter_height"]),
            "--radius-km", str(min(case["radius"], 100000.0) / 1000.0),
            "--terrain", "test/fixtures/terrain.s16",
            "--out", out]
    t0 = time.monotonic()
    subprocess.run(args, check=True, capture_output=True, text=True)
    dt = time.monotonic() - t0
    for ext in (".signal.u8", ".mask.u8"):
        with open(out + ext, "rb") as src, gzip.open(out + ext + ".gz", "wb", 6) as dst:
            shutil.copyfileobj(src, dst)
        os.remove(out + ext)
    print(f"{name}: {dt:.2f}s -> {out}.{{signal.u8.gz,mask.u8.gz,meta.json}}")
EOF

ls -la "$OUT_DIR"
