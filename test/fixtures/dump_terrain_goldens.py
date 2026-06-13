"""Dump terrain-pipeline goldens using the backend's exact code path.

Runs INSIDE the legacy app container (see generate.sh). For each tile it
writes two goldens into /fixtures/golden/:

  <tile>_1201_avg_i2le.bin.gz   the 3601x3601 -> 1201x1201 rasterio
                                Resampling.average grid (little-endian int16,
                                row-major, row 0 = north edge) that the browser
                                terrain service must reproduce
  <sdf-name>.sdf.gz             the srtm2sdf output consumed by SPLAT!,
                                pinning the SDF cell order end to end
"""

import glob
import gzip
import io
import json
import os
import sys
import tempfile

sys.path.insert(0, "/app")

import rasterio
from rasterio.enums import Resampling

from app.services.splat import Splat

OUT_DIR = "/fixtures/golden"
TERRAIN_DIR = "/fixtures/terrain"
TILES = ["N51W115.hgt.gz", "N51W001.hgt.gz"]


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    splat = Splat(splat_path="/app/splat", cache_dir="/tmp/.splat_tiles")

    for tile in TILES:
        stem = tile.replace(".hgt.gz", "")
        raw = splat._download_terrain_tile(tile)

        # (a) Replicate the exact downsample in Splat._convert_hgt_to_sdf.
        with tempfile.TemporaryDirectory() as td:
            hgt_path = os.path.join(td, tile.replace(".gz", ""))
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as gz:
                with open(hgt_path, "wb") as f:
                    f.write(gz.read())
            with rasterio.open(hgt_path) as src:
                data = src.read(
                    out_shape=(src.count, 1201, 1201),
                    resampling=Resampling.average,
                )
        grid = data[0].astype("<i2")
        out_a = os.path.join(OUT_DIR, f"{stem}_1201_avg_i2le.bin.gz")
        with gzip.open(out_a, "wb") as f:
            f.write(grid.tobytes())
        print(f"wrote {out_a} shape={grid.shape}")

        # (b) Full srtm2sdf output for the same tile.
        sdf_name = Splat._hgt_filename_to_sdf_filename(tile, high_resolution=False)
        sdf_bytes = splat._convert_hgt_to_sdf(raw, tile, high_resolution=False)
        out_b = os.path.join(OUT_DIR, f"{sdf_name}.gz")
        with gzip.open(out_b, "wb") as f:
            f.write(sdf_bytes)
        print(f"wrote {out_b} bytes={len(sdf_bytes)}")

    # Every SDF tile each fixture case used, so the native/wasm engine can be
    # fed byte-identical terrain during golden comparisons.
    os.makedirs(TERRAIN_DIR, exist_ok=True)
    for case_path in sorted(glob.glob("/fixtures/cases/*.json")):
        with open(case_path) as f:
            case = json.load(f)
        tiles = Splat._calculate_required_terrain_tiles(
            case["lat"], case["lon"], case["radius"]
        )
        for tile_name, sdf_name, _ in tiles:
            out = os.path.join(TERRAIN_DIR, f"{sdf_name}.gz")
            if os.path.exists(out):
                continue
            raw = splat._download_terrain_tile(tile_name)
            sdf_bytes = splat._convert_hgt_to_sdf(raw, tile_name, high_resolution=False)
            with gzip.open(out, "wb") as f:
                f.write(sdf_bytes)
            print(f"wrote {out} bytes={len(sdf_bytes)}")


if __name__ == "__main__":
    main()
