#!/usr/bin/env python3
"""Tier-A parity check: native engine vs legacy-backend golden GeoTIFFs.

For each test/fixtures/cases/*.json this script:
  1. unpacks the SDF terrain tiles the backend used into raw .s16 pages,
  2. runs the native engine CLI (engine/build/splat_cli) with the exact
     parameter conversions the backend applied (including its quirks:
     tx height consumed as feet, rx_gain unused),
  3. forward-models the engine's signal grid through SPLAT!'s rendering
     pipeline (DCF contour levels, -sc smooth-contour interpolation,
     PIL RGB->L grayscale, 255 = nodata) to produce the palette-index
     image the backend would have written,
  4. compares it against the golden GeoTIFF pixel-for-pixel.

Pass criteria per case: >= 99.5% nodata-mask agreement and >= 99% of
joint-coverage pixels within +/-1 gray level.

Usage:
  python3 scripts/compare_golden.py [--cli engine/build/splat_cli] [case ...]

Requires: numpy, tifffile, pillow, matplotlib (see scripts/requirements-compare.txt).
"""

import argparse
import gzip
import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np
import tifffile
from PIL import Image
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES_DIR = os.path.join(REPO, "test", "fixtures", "cases")
GOLDEN_DIR = os.path.join(REPO, "test", "fixtures", "golden")
TERRAIN_DIR = os.path.join(REPO, "test", "fixtures", "terrain")
PAGES_DIR = os.path.join(REPO, "test", "fixtures", "terrain.s16")

CLIMATE = {
    "equatorial": 1,
    "continental_subtropical": 2,
    "maritime_subtropical": 3,
    "desert": 4,
    "continental_temperate": 5,
    "maritime_temperate_land": 6,
    "maritime_temperate_sea": 7,
}
POLARIZATION = {"horizontal": 0, "vertical": 1}


def sdf_to_s16(sdf_gz_path: str, out_dir: str) -> str:
    """Convert a gzipped SPLAT! SDF text file to a raw .s16 page file.

    SDF layout (srtm2sdf.c / LoadSDF_SDF): 4 header lines
    (max_west, min_north, min_west, max_north) then 1200*1200 integers,
    outer index x ascending south->north, inner y ascending east->west.
    The .s16 file keeps that exact order as little-endian int16.
    """
    with gzip.open(sdf_gz_path, "rt") as f:
        max_west = int(f.readline())
        min_north = int(f.readline())
        int(f.readline())  # min_west
        int(f.readline())  # max_north
        data = np.loadtxt(f, dtype=np.int32, max_rows=1200 * 1200)
    if data.size != 1200 * 1200:
        raise ValueError(f"{sdf_gz_path}: expected 1440000 values, got {data.size}")
    # Page naming uses min_west: the page covering wp lon [min_west, max_west)
    page_min_west = (max_west - 1) % 360
    out = os.path.join(out_dir, f"page_{min_north}_{page_min_west}.s16")
    data.astype("<i2").tofile(out)
    return out


def prepare_terrain() -> None:
    os.makedirs(PAGES_DIR, exist_ok=True)
    for name in sorted(os.listdir(TERRAIN_DIR)):
        if not name.endswith(".sdf.gz"):
            continue
        # Cheap freshness check: skip if any page file is newer than archive
        src = os.path.join(TERRAIN_DIR, name)
        out = sdf_to_s16_path_hint(src)
        if out and os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src):
            continue
        path = sdf_to_s16(src, PAGES_DIR)
        print(f"  terrain: {name} -> {os.path.basename(path)}")


def sdf_to_s16_path_hint(sdf_gz_path: str):
    base = os.path.basename(sdf_gz_path).replace(".sdf.gz", "")
    try:
        minlat, _maxlat, minlon, _maxlon = base.split(":")
        return os.path.join(PAGES_DIR, f"page_{int(minlat)}_{int(minlon)}.s16")
    except ValueError:
        return None


def run_engine(cli: str, case: dict, out_prefix: str) -> dict:
    erp_watts = 10 ** (
        (case["tx_power"] + case["tx_gain"] - case["system_loss"] - 30) / 10
    )
    args = [
        cli,
        "--lat", str(case["lat"]),
        "--lon", str(case["lon"]),
        # Legacy quirk: the backend wrote the QTH height without the meters
        # suffix, so SPLAT! consumed tx_height as feet. Replicate.
        "--txft", str(case["tx_height"]),
        # -L with -metric converts rx height meters -> feet.
        "--rxft", str(case["rx_height"] / 0.3048),
        "--freq", str(case["frequency_mhz"]),
        "--erp", f"{erp_watts:.2f}",  # lrp file wrote %.2f
        "--dielect", str(case["ground_dielectric"]),
        "--cond", str(case["ground_conductivity"]),
        "--bend", str(case["atmosphere_bending"]),
        "--climate", str(CLIMATE[case["radio_climate"]]),
        "--pol", str(POLARIZATION[case["polarization"]]),
        "--conf", f"{case['situation_fraction'] / 100.0:.2f}",  # lrp %.2f
        "--rel", f"{case['time_fraction'] / 100.0:.2f}",
        "--clutter-m", str(case["clutter_height"]),
        "--radius-km", str(min(case["radius"], 100000.0) / 1000.0),
        "--terrain", PAGES_DIR,
        "--out", out_prefix,
    ]
    subprocess.run(args, check=True, capture_output=True, text=True)
    with open(out_prefix + ".meta.json") as f:
        meta = json.load(f)
    n = meta["width"] * meta["height"]
    signal = np.fromfile(out_prefix + ".signal.u8", dtype=np.uint8, count=n)
    mask = np.fromfile(out_prefix + ".mask.u8", dtype=np.uint8, count=n)
    meta["signal"] = signal.reshape(meta["height"], meta["width"])
    meta["mask"] = mask.reshape(meta["height"], meta["width"])
    return meta


def dcf_levels_and_colors(colormap: str, min_dbm: float, max_dbm: float):
    """Replicate Splat._create_splat_dcf + splat.cpp LoadDBMColors."""
    cmap = plt.get_cmap(colormap)
    cmap_values = np.linspace(max_dbm, min_dbm, 32)
    cmap_norm = plt.Normalize(vmin=min_dbm, vmax=max_dbm)
    rgb = (cmap(cmap_norm(cmap_values))[:, :3] * 255).astype(int)
    levels = np.array([int(v) for v in cmap_values], dtype=np.int32)  # trunc
    return levels, rgb


def interpolate(y0: int, y1: int, x0: int, x1: int, n: int) -> int:
    """splat.cpp:190 interpolate(), ceil semantics included."""
    if n <= x0:
        return y0
    if n >= x1:
        return y1
    if y0 == y1 or x0 == x1:
        return y0
    return y0 + int(math.ceil(((y0 - y1) / (x0 - x1)) * (n - x0)))


def forward_render(signal: np.ndarray, mask: np.ndarray, case: dict) -> np.ndarray:
    """signal/mask grids -> the palette-index image the backend produced.

    Replicates WritePPMDBM (-dbm -sc -ngs -kml) followed by the backend's
    PIL convert('L'). Returns uint8 grayscale indices, 255 = nodata.
    """
    levels, colors = dcf_levels_and_colors(
        case["colormap"], case["min_dbm"], case["max_dbm"]
    )
    threshold = int(case["signal_threshold"])  # -db parsed via %d

    # Precompute dBm -> RGB for every possible signal byte (0..255).
    lut = np.full((256, 3), 255, dtype=np.uint8)  # default white
    for sig in range(256):
        dbm = sig - 200
        if threshold != 0 and dbm < threshold:
            continue  # white (ngs, below threshold)
        if dbm >= levels[0]:
            match = 0
        else:
            match = 255
            for z in range(1, len(levels)):
                if levels[z - 1] > dbm >= levels[z]:
                    match = z
                    break
        if match >= len(levels):
            continue  # below all contour levels -> white
        if match > 0:  # smooth contours
            r = interpolate(colors[match][0], colors[match - 1][0],
                            levels[match], levels[match - 1], dbm)
            g = interpolate(colors[match][1], colors[match - 1][1],
                            levels[match], levels[match - 1], dbm)
            b = interpolate(colors[match][2], colors[match - 1][2],
                            levels[match], levels[match - 1], dbm)
        else:
            r, g, b = colors[0]
        if r == 0 and g == 0 and b == 0:
            continue  # black contour color renders as background (white)
        lut[sig] = (r, g, b)

    h, w = signal.shape
    rgb = np.full((h, w, 3), 255, dtype=np.uint8)
    covered = (mask & 248) != 0
    rgb[covered] = lut[signal[covered]]

    gray = np.array(Image.fromarray(rgb, "RGB").convert("L"))
    return gray


def compare_case(name: str, cli: str, tmpdir: str) -> bool:
    with open(os.path.join(CASES_DIR, f"{name}.json")) as f:
        case = json.load(f)

    golden_path = os.path.join(GOLDEN_DIR, f"{name}.tif")
    golden = tifffile.imread(golden_path)

    meta = run_engine(cli, case, os.path.join(tmpdir, name))
    engine_gray = forward_render(meta["signal"], meta["mask"], case)

    print(f"  golden {golden.shape}, engine {engine_gray.shape}, "
          f"pages {meta['pages_loaded']}/{meta['pages']}, "
          f"radials {meta['radials']}, itm_errnums {meta['itm_errnums']}")

    if golden.shape != engine_gray.shape:
        print(f"  FAIL: shape mismatch")
        return False

    g_nodata = golden == 255
    e_nodata = engine_gray == 255
    mask_agree = np.mean(g_nodata == e_nodata)

    joint = ~g_nodata & ~e_nodata
    if joint.sum() == 0:
        print("  FAIL: no joint coverage")
        return False
    diff = np.abs(golden[joint].astype(int) - engine_gray[joint].astype(int))
    within1 = np.mean(diff <= 1)

    print(f"  nodata agreement: {mask_agree * 100:.3f}%  "
          f"(golden covered: {(~g_nodata).mean() * 100:.1f}%, "
          f"engine covered: {(~e_nodata).mean() * 100:.1f}%)")
    print(f"  joint pixels within +/-1 gray: {within1 * 100:.3f}%  "
          f"max diff: {diff.max()}  mean: {diff.mean():.4f}")

    ok = mask_agree >= 0.995 and within1 >= 0.99
    print(f"  {'PASS' if ok else 'FAIL'}")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cli", default=os.path.join(REPO, "engine", "build", "splat_cli"))
    ap.add_argument("cases", nargs="*",
                    default=[os.path.splitext(f)[0]
                             for f in sorted(os.listdir(CASES_DIR))
                             if f.endswith(".json")])
    args = ap.parse_args()

    print("Preparing terrain pages...")
    prepare_terrain()

    all_ok = True
    with tempfile.TemporaryDirectory() as tmpdir:
        for name in args.cases:
            print(f"Case {name}:")
            ok = compare_case(name, args.cli, tmpdir)
            all_ok &= ok

    print("ALL PASS" if all_ok else "FAILURES PRESENT")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
