"""
Signal Propagation Prediction API

FastAPI application for RF propagation modeling using ITM (Irregular Terrain Model)
with SRTM terrain data. Wraps geoprop-py (https://github.com/JayKickliter/geoprop-py),
a Rust implementation based on NTIA's ITM reference.

Endpoints:
    POST /area - Predict path loss over a geographic area using H3 hexagons
    POST /p2p - Predict path loss between two points
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from geoprop import Tiles, Itm, Point, Profile, Climate, Polarization, ModeVariability
from typing import Literal, Optional
from dotenv import load_dotenv
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


class AreaPredictRequest(BaseModel):
    """
    expected input payload for the /area endpoint.
    """

    lat: float = Field(..., ge=-90, le=90, description="transmitter latitude")
    lon: float = Field(..., ge=-180, le=180, description="transmitter longitude")
    txh: float = Field(1.0, gt=0, description="transmitter height in meters")
    rxh: float = Field(1.0, gt=0, description="receiver height in meters")
    tx_gain: float = Field(1.0, ge=0, description="transmitter gain in dB")
    rx_gain: float = Field(1.0, ge=0, description="receiver gain in dB")
    resolution: int = Field(8, ge=7, le=12, description="simulation h3 cell resolution")
    frequency: float = Field(..., gt=0, description="signal frequency in MHz")

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


class P2PPredictRequest(BaseModel):
    """
    Expected input payload for the /p2p endpoint.
    """

    tx_lat: float = Field(..., ge=-90, le=90, description="transmitter latitude")
    tx_lon: float = Field(..., ge=-180, le=180, description="transmitter longitude")
    txh: float = Field(1.0, gt=0, description="transmitter height in meters")
    rx_lat: float = Field(..., ge=-90, le=90, description="receiver latitude")
    rx_lon: float = Field(..., ge=-180, le=180, description="receiver longitude")
    rxh: float = Field(1.0, gt=0, description="receiver height in meters")
    frequency: float = Field(..., gt=0, description="signal frequency in MHz")

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


@api.post("/area")
async def predict(payload: AreaPredictRequest) -> JSONResponse:
    """
    Predicts signal coverage using the ITM model.

    Args:
        lat: Transmitter latitude (-90 to 90)
        lon: Transmitter longitude (-180 to 180)
        txh: Transmitter height in meters (default: 1.0)
        rxh: Receiver height in meters (default: 1.0)
        tx_gain: Transmitter gain in dB (default: 1.0)
        rx_gain: Receiver gain in dB (default: 1.0)
        resolution: H3 cell resolution (7-12, default: 8)
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
        GeoJSON FeatureCollection with H3 hexagons containing path loss predictions.
        Each feature has properties: {"loss_db": float}

    Raises:
        HTTPException: 400 if model calculation fails.

    Example:
        Request:
        {
            "lat": 37.7749,
            "lon": -122.4194,
            "frequency": 915.0,
            "txh": 10.0,
            "rxh": 2.0,
            "resolution": 8,
            "climate": "continental_temperate",
            "pol": "vertical"
        }

        Response:
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-122.42, 37.77], ...]]
                    },
                    "properties": {"loss_db": 85.2}
                },
                ...
            ]
        }
    """

    logging.info(f"Received prediction request: {payload.model_dump()}")

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
        prediction_h3 = itm.coverage(
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
    end_time = time.time()
    duration = end_time - start_time
    logging.info(
        f"ITM model calculation completed successfully in {duration:.2f} seconds."
    )

    features = []
    for row in prediction_h3:
        hex_boundary = h3.cell_to_boundary(hex(row[0]))
        loss_db = row[2]

        features.append(
            geojson.Feature(
                geometry=geojson.Polygon([hex_boundary]),
                properties={"loss_db": loss_db},
            )
        )

    feature_collection = geojson.FeatureCollection(features)

    return JSONResponse(content=feature_collection)


@api.post("/p2p")
async def predict_p2p(payload: P2PPredictRequest) -> JSONResponse:
    """
    Predicts path loss between two points using the ITM model.

    Args:
        tx_lat: Transmitter latitude (-90 to 90)
        tx_lon: Transmitter longitude (-180 to 180)
        txh: Transmitter height in meters (default: 1.0)
        rx_lat: Receiver latitude (-90 to 90)
        rx_lon: Receiver longitude (-180 to 180)
        rxh: Receiver height in meters (default: 1.0)
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
        JSON object with path loss in dB.

    Raises:
        HTTPException: 400 if model calculation fails.

    Example:
        Request:
        {
            "tx_lat": 37.7749,
            "tx_lon": -122.4194,
            "txh": 10.0,
            "rx_lat": 37.8044,
            "rx_lon": -122.2712,
            "rxh": 2.0,
            "frequency": 915.0,
            "climate": "continental_temperate",
            "pol": "vertical"
        }

        Response:
        {
            "loss_db": 85.2
        }
    """

    logging.info(f"Received p2p prediction request: {payload.model_dump()}")

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
    except ValueError as e:
        logging.error(f"Model calculation error: {str(e)}")
        raise HTTPException(
            status_code=400, detail=f"Error generating model prediction: {str(e)}"
        )
    end_time = time.time()
    duration = end_time - start_time
    logging.info(f"ITM p2p calculation completed successfully in {duration:.2f} seconds.")

    return JSONResponse(content={"loss_db": loss_db})
