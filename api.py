"""
Signal Propagation Prediction API

FastAPI application for RF propagation modeling using ITM (Irregular Terrain Model)
with SRTM terrain data. Wraps geoprop-py (https://github.com/JayKickliter/geoprop-py),
a Rust implementation based on NTIA's ITM reference. This API is intended for use 
with Meshtastic LoRa radios to identify optimal transmitter locations and coverage areas, 
as well as to compute link budgets between specific transmitter and receiver locations.

Default parameters for the ITM model are chosen based on common use cases for LoRa
deployments, but can be overridden via the API arguments. See the ITM technical report 
for more details on the model and its parameters.

Endpoints:
    POST /coverage/h3 - Predict coverage as H3 hexagon GeoJSON
    POST /coverage/grid - Predict coverage as centroid point GeoJSON
    POST /coverage/contour - Predict coverage as contour band GeoJSON
    POST /link - Predict path loss between two specific points

References:
    ITM Technical Report: https://its.ntia.gov/software/itm
    NTIA C++ Implementation: https://github.com/NTIA/itm
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from geoprop import Tiles, Itm, Point, Profile, Climate, Polarization, ModeVariability
from typing import Literal, Optional
from dotenv import load_dotenv
from shapely.geometry import Polygon as ShapelyPolygon, MultiPolygon as ShapelyMultiPolygon
from shapely.ops import unary_union
from scipy.interpolate import griddata
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import logging
import geojson
import h3
import sys
import os
import time

logging.basicConfig(level=logging.INFO)
api = FastAPI()

# Add CORS middleware
api.add_middleware(
    CORSMiddleware,
    allow_origins=["https://127.0.0.1:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_config() -> dict:
    if not os.path.exists(".env"):
        logging.error(f".env file not found.")
        sys.exit(1)
    
    load_dotenv(".env")
    
    tile_dir = os.getenv("tile_dir")
    max_distance_km = os.getenv("max_distance_km")
    
    if tile_dir is None:
        logging.error("tile_dir is required in .env file")
        sys.exit(1)
    
    if max_distance_km is None:
        logging.error("max_distance_km is required in .env file")
        sys.exit(1)
    
    try:
        max_distance_km = float(max_distance_km)
    except ValueError as e:
        logging.error(f"max_distance_km must be a valid float: {e}")
        sys.exit(1)
    
    return {
        "tile_dir": tile_dir,
        "max_distance_km": max_distance_km,
    }


logging.info("Loading configuration...")
config = load_config()
logging.info(f"Configuration loaded: {config}")
logging.info(f"Loading SRTM tiles...")
tiles = Tiles(config["tile_dir"])
logging.info(f'SRTM tiles loaded: {config["tile_dir"]}')


class CoveragePredictRequest(BaseModel):
    """
    Expected input payload for the /coverage/h3 and /coverage/contour endpoints.
    """

    lat: float = Field(..., gt=-90, lt=90, description="transmitter latitude")
    lon: float = Field(..., gt=-180, lt=180, description="transmitter longitude")
    txh: float = Field(1.0, gt=0, description="transmitter height in meters")
    rxh: float = Field(1.0, gt=0, description="receiver height in meters")
    tx_gain: float = Field(1.0, ge=1.0, description="transmitter gain in dB")
    rx_gain: float = Field(1.0, ge=1.0, description="receiver gain in dB")
    resolution: int = Field(8, ge=7, le=12, description="simulation h3 cell resolution")
    frequency: float = Field(..., gt=50, description="signal frequency in MHz") # below ~50MHz non-LOS propagation dominates, model is not accurate. 

    # Optional ITM parameters
    climate: Optional[
        Literal[
            "equatorial",
            "continental_subtropical",
            "maritime_subtropical",
            "desert",
            "continental_temperate",
            "maritime_temperate_over_land",
            "maritime_temperate_over_sea",
        ]
    ] = None
    n0: Optional[float] = None
    pol: Optional[Literal["horizontal", "vertical"]] = None
    epsilon: Optional[float] = None
    sigma: Optional[float] = None
    mdvar: Optional[Literal["single_message", "accidental", "mobile", "broadcast"]] = (
        None
    )
    time: Optional[float] = None
    location: Optional[float] = None
    situation: Optional[float] = None


class LinkRequest(BaseModel):
    """
    Expected input payload for the /link endpoint.
    """

    tx_lat: float = Field(..., gt=-90, lt=90, description="transmitter latitude")
    tx_lon: float = Field(..., gt=-180, lt=180, description="transmitter longitude")
    txh: float = Field(1.0, gt=0, description="transmitter height in meters")
    rx_lat: float = Field(..., gt=-90, lt=90, description="receiver latitude")
    rx_lon: float = Field(..., gt=-180, lt=180, description="receiver longitude")
    rxh: float = Field(1.0, gt=0, description="receiver height in meters")
    tx_gain: float = Field(1.0, ge=1.0, description="transmitter gain in dB")
    rx_gain: float = Field(1.0, ge=0, description="receiver gain in dB")
    frequency: float = Field(..., gt=50, description="signal frequency in MHz") # below ~50MHz non-LOS propagation dominates, model is not accurate. 

    # Optional ITM parameters
    climate: Optional[
        Literal[
            "equatorial",
            "continental_subtropical",
            "maritime_subtropical",
            "desert",
            "continental_temperate",
            "maritime_temperate_over_land",
            "maritime_temperate_over_sea",
        ]
    ] = None
    n0: Optional[float] = None
    pol: Optional[Literal["horizontal", "vertical"]] = None
    epsilon: Optional[float] = None
    sigma: Optional[float] = None
    mdvar: Optional[Literal["single_message", "accidental", "mobile", "broadcast"]] = None
    time: Optional[float] = None
    location: Optional[float] = None
    situation: Optional[float] = None

def run_coverage_prediction(payload: CoveragePredictRequest) -> dict[str, float]:
    """
    Run ITM area coverage prediction.

    Args:
        payload: Validated area prediction request.

    Returns:
        Dict mapping H3 hex index to path loss in dB.
        Example: {"882a100d65fffff": 85.2, "882a100d67fffff": 92.1}

    Raises:
        HTTPException: 400 if model calculation fails.
    """
    climate_map = {
        "equatorial": Climate.Equatorial,
        "continental_subtropical": Climate.ContinentalSubtropical,
        "maritime_subtropical": Climate.MaritimeSubtropical,
        "desert": Climate.Desert,
        "continental_temperate": Climate.ContinentalTemperate,
        "maritime_temperate_over_land": Climate.MaritimeTemperateOverLand,
        "maritime_temperate_over_sea": Climate.MaritimeTemperateOverSea,
    }
    pol_map = {"horizontal": Polarization.Horizontal, "vertical": Polarization.Vertical}
    mdvar_map = {
        "single_message": ModeVariability.SingleMessage,
        "accidental": ModeVariability.Accidental,
        "mobile": ModeVariability.Mobile,
        "broadcast": ModeVariability.Broadcast,
    }

    start_time = time.time()
    try:
        itm = Itm(
            tiles,
            climate=climate_map.get(payload.climate) if payload.climate else None,
            n0=payload.n0,
            pol=pol_map.get(payload.pol) if payload.pol else None,
            epsilon=payload.epsilon,
            sigma=payload.sigma,
            mdvar=mdvar_map.get(payload.mdvar) if payload.mdvar else None,
            time=payload.time,
            location=payload.location,
            situation=payload.situation,
        )

        center = Point(payload.lat, payload.lon, payload.txh)
        raw_results = itm.coverage(
            center,
            payload.resolution,
            payload.frequency * 1e6,
            config["max_distance_km"],
            payload.rxh,
            rx_threshold_db=None,
        )
    except ValueError as e:
        logging.error(f"Model calculation error: {str(e)}")
        raise HTTPException(
            status_code=400, detail=f"Error generating model prediction: {str(e)}"
        )

    duration = time.time() - start_time
    logging.info(f"ITM model calculation completed in {duration:.2f} seconds.")

    # Convert list of (cell_id: u64, elevation: f32, loss_db: f64) to {h3_hex: loss_db}
    return {hex(cell_id): loss_db for cell_id, _elev, loss_db in raw_results}


def coverage_to_contour_geojson(coverage: dict[str, float], levels: list[float] | None = None) -> dict:
    """
    Convert coverage dict to contour band GeoJSON.

    Args:
        coverage: Dict mapping H3 hex index to path loss in dB.
        levels: Contour break points in dB. Defaults to 10 dB steps spanning the data.

    Returns:
        GeoJSON FeatureCollection with one MultiPolygon per contour band.
        Each feature has properties: {"min_db": float, "max_db": float}
    """
    lats, lons, values = [], [], []
    for h3_index, loss_db in coverage.items():
        cell_lat, cell_lon = h3.cell_to_latlng(h3_index)
        lats.append(cell_lat)
        lons.append(cell_lon)
        values.append(loss_db)

    lats = np.array(lats)
    lons = np.array(lons)
    values = np.array(values)

    if levels is None:
        vmin = int(np.floor(values.min() / 10) * 10)
        vmax = int(np.ceil(values.max() / 10) * 10)
        levels = list(range(vmin, vmax + 10, 10))

    # Interpolate H3 cell centers onto a regular grid
    grid_res = 200
    lon_grid = np.linspace(lons.min(), lons.max(), grid_res)
    lat_grid = np.linspace(lats.min(), lats.max(), grid_res)
    lon_mesh, lat_mesh = np.meshgrid(lon_grid, lat_grid)

    grid_values = griddata(
        (lons, lats), values, (lon_mesh, lat_mesh), method="cubic", fill_value=np.nan
    )

    # Generate filled contours
    fig, ax = plt.subplots()
    cs = ax.contourf(lon_mesh, lat_mesh, grid_values, levels=levels)
    plt.close(fig)

    # Convert contour segments to GeoJSON MultiPolygons.
    # cs.allsegs[i] is a list of Nx2 arrays for contour level i.
    features = []
    for i, segs in enumerate(cs.allsegs):
        if not segs:
            continue

        polygons = []
        for seg in segs:
            if len(seg) < 4:
                continue
            coords = [(float(x), float(y)) for x, y in seg]
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            try:
                poly = ShapelyPolygon(coords)
                if poly.is_valid and not poly.is_empty:
                    polygons.append(poly)
            except Exception:
                continue

        if not polygons:
            continue

        # Sort by area descending so smaller contained polygons become holes
        polygons.sort(key=lambda p: p.area, reverse=True)

        result_polys = []
        used = set()
        for j, outer in enumerate(polygons):
            if j in used:
                continue
            holes = []
            for k, inner in enumerate(polygons):
                if k <= j or k in used:
                    continue
                if outer.contains(inner):
                    holes.append(inner.exterior.coords)
                    used.add(k)
            result_polys.append(ShapelyPolygon(outer.exterior.coords, holes))

        merged = unary_union(result_polys)
        if isinstance(merged, ShapelyPolygon):
            merged = ShapelyMultiPolygon([merged])

        multi_coords = []
        for poly in merged.geoms:
            rings = [list(poly.exterior.coords)]
            rings.extend(list(hole.coords) for hole in poly.interiors)
            multi_coords.append(rings)

        features.append(
            geojson.Feature(
                geometry=geojson.MultiPolygon(multi_coords),
                properties={
                    "min_db": float(levels[i]),
                    "max_db": float(levels[i + 1]),
                },
            )
        )

    return geojson.FeatureCollection(features)


@api.post("/coverage/h3")
async def predict_coverage_h3(payload: CoveragePredictRequest) -> JSONResponse:
    """
    Predict signal coverage as H3 hexagons.

    Returns:
        GeoJSON FeatureCollection where each Feature is an H3 cell polygon
        with property: {"loss_db": float}
    """
    logging.info(f"Received /coverage/h3 request: {payload.model_dump()}")

    coverage = run_coverage_prediction(payload)

    features = []
    for h3_index, loss_db in coverage.items():
        hex_boundary = h3.cell_to_boundary(h3_index)
        features.append(
            geojson.Feature(
                geometry=geojson.Polygon([hex_boundary]),
                properties={"loss_db": loss_db},
            )
        )

    return JSONResponse(content=geojson.FeatureCollection(features))


@api.post("/coverage/grid")
async def predict_coverage_grid(payload: CoveragePredictRequest) -> JSONResponse:
    """
    Predict signal coverage as a grid of points at H3 cell centroids.

    Returns:
        GeoJSON FeatureCollection where each Feature is a Point at
        the H3 cell centroid with property: {"loss_db": float}
    """
    logging.info(f"Received /coverage/grid request: {payload.model_dump()}")

    coverage = run_coverage_prediction(payload)

    features = []
    for h3_index, loss_db in coverage.items():
        lat, lon = h3.cell_to_latlng(h3_index)
        features.append(
            geojson.Feature(
                geometry=geojson.Point((lon, lat)),
                properties={"loss_db": loss_db},
            )
        )

    return JSONResponse(content=geojson.FeatureCollection(features))


@api.post("/coverage/contour")
async def predict_coverage_contour(payload: CoveragePredictRequest) -> JSONResponse:
    """
    Predict signal coverage as contour bands.

    Returns:
        GeoJSON FeatureCollection where each Feature is a contour band MultiPolygon
        with properties: {"min_db": float, "max_db": float}
    """
    logging.info(f"Received /coverage/contour request: {payload.model_dump()}")

    coverage = run_coverage_prediction(payload)
    return JSONResponse(content=coverage_to_contour_geojson(coverage))


@api.post("/link")
async def link(payload: LinkRequest) -> JSONResponse:
    """
    Predicts path loss between two points using the ITM model.

    Args:
        tx_lat: Transmitter latitude (-90 to 90)
        tx_lon: Transmitter longitude (-180 to 180)
        txh: Transmitter height in meters (default: 1.0)
        rx_lat: Receiver latitude (-90 to 90)
        rx_lon: Receiver longitude (-180 to 180)
        rxh: Receiver height in meters (default: 1.0)
        tx_gain: Transmitter gain in dB (default: 1.0)
        rx_gain: Receiver gain in dB (default: 1.0)
        frequency: Signal frequency in MHz (required)
        climate: Climate type (optional, default: continental_temperate)
        n0: Refractivity (optional, default: 301.0)
        pol: Polarization horizontal/vertical (optional, default: vertical)
        epsilon: Relative permittivity (optional, default: 15.0)
        sigma: Conductivity (optional, default: 0.005)
        mdvar: Mode variability (optional, default: mobile)
        time: Time variability % (optional, default: 95.0)
        location: Location variability % (optional, default: 95.0)
        situation: Situation variability % (optional, default: 95.0)

    Returns:
        JSON object with path loss, distance, and terrain profile data:
        - loss_db: Path loss in dB
        - distance_m: Total distance between points in meters
        - terrain_profile_m: Array of terrain elevations in meters
        - distances_m: Array of cumulative distances in meters

    Raises:
        HTTPException: 400 if model calculation fails.
    """

    logging.info(f"Received /link request: {payload.model_dump()}")

    climate_map = {
        "equatorial": Climate.Equatorial,
        "continental_subtropical": Climate.ContinentalSubtropical,
        "maritime_subtropical": Climate.MaritimeSubtropical,
        "desert": Climate.Desert,
        "continental_temperate": Climate.ContinentalTemperate,
        "maritime_temperate_over_land": Climate.MaritimeTemperateOverLand,
        "maritime_temperate_over_sea": Climate.MaritimeTemperateOverSea,
    }
    pol_map = {"horizontal": Polarization.Horizontal, "vertical": Polarization.Vertical}
    mdvar_map = {
        "single_message": ModeVariability.SingleMessage,
        "accidental": ModeVariability.Accidental,
        "mobile": ModeVariability.Mobile,
        "broadcast": ModeVariability.Broadcast,
    }

    start_time = time.time()
    try:
        itm = Itm(
            tiles,
            climate=climate_map.get(payload.climate) if payload.climate else None,
            n0=payload.n0,
            pol=pol_map.get(payload.pol) if payload.pol else None,
            epsilon=payload.epsilon,
            sigma=payload.sigma,
            mdvar=mdvar_map.get(payload.mdvar) if payload.mdvar else None,
            time=payload.time,
            location=payload.location,
            situation=payload.situation,
        )

        start = Point(payload.tx_lat, payload.tx_lon, payload.txh)
        end = Point(payload.rx_lat, payload.rx_lon, payload.rxh)
        profile = Profile(tiles, start, end)

        loss_db = itm.p2p(profile, payload.frequency * 1e6)
        
        # Get terrain profile and distance data
        distances_m = list(profile.distances())
        elevation_m = list(profile.elevation())
        distance_m = distances_m[-1] if distances_m else 0.0
    except ValueError as e:
        logging.error(f"Model calculation error: {str(e)}")
        raise HTTPException(
            status_code=400, detail=f"Error generating model prediction: {str(e)}"
        )
    end_time = time.time()
    duration = end_time - start_time
    logging.info(f"ITM link calculation completed in {duration:.2f} seconds.")

    return JSONResponse(content={
        "loss_db": loss_db,
        "distance_m": distance_m,
        "terrain_profile_m": elevation_m,
        "distances_m": distances_m,
    })
