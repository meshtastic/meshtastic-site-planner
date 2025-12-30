"""
Meshtastic Signal Coverage Prediction App

This FastAPI application provides an endpoint to predict Meshtastic signal coverage
using the ITM (Irregular Terrain Model). The prediction takes into account
transmitter and receiver characteristics, geographical location, and regional LoRa settings.

Key components:
- PredictRequest: Input payload structure for the prediction.
- load_config: Loads configuration values from environment variables.
- /predict endpoint: Provides signal coverage prediction in GeoJSON format.

Requirements:
- SRTM (Shuttle Radar Topography Mission) data tiles for terrain elevation
- geoprop-py submodule
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from geoprop import Tiles, Itm, Point, Climate
from regions import meshtastic_regions
from typing import Literal
import logging
import geojson
import h3
import sys
import os
import time


logging.basicConfig(level=logging.INFO)
app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://127.0.0.1:8080"],
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods (GET, POST, etc.)
    allow_headers=["*"],  # Allows all headers
)


def load_config() -> dict:
    def get_env_var(var_name: str, convert_type=None, default=None):
        value = os.getenv(var_name, default)
        if value is None:
            logging.error(
                f"{var_name} is required and not set in the environment variables."
            )
            sys.exit(1)
        try:
            return convert_type(value) if convert_type else value
        except ValueError as e:
            logging.error(f"Invalid value for {var_name}: {e}")
            sys.exit(1)

    return {
        "tile_dir": get_env_var("tile_dir"),  # SRTM data folder for 30m.hgt files
        "h3_res": get_env_var(
            "h3_res", int
        ),  # fixed h3 cell resolution for simulation results
        "max_distance_km": get_env_var(
            "max_distance_km", float
        ),  # fixed max distance from the transmitter for the simulation in km
    }


logging.info("Loading configuration...")
config = load_config()
logging.info(f"Configuration loaded: {config}")
logging.info(f"Loading SRTM tiles...")
tiles = Tiles(config["tile_dir"])
logging.info(f'SRTM tiles loaded: {config["tile_dir"]}')

itm = Itm(tiles, climate=Climate.ContinentalTemperate)


class PredictRequest(BaseModel):
    """
    expected input payload for the /predict endpoint.
    """

    lat: float = Field(..., ge=-90, le=90, description="transmitter latitude")
    lon: float = Field(..., ge=-180, le=180, description="transmitter longitude")
    txh: float = Field(1.0, gt=0, description="transmitter height in meters")
    rxh: float = Field(1.0, gt=0, description="receiver height in meters")
    tx_gain: float = Field(1.0, ge=0, description="transmitter gain in dB")
    rx_gain: float = Field(1.0, ge=0, description="receiver gain in dB")
    region: Literal[*meshtastic_regions.keys()] = Field(
        "US", description="meshtastic LoRa region code"
    )
    resolution: int = Field(8, ge=7, le=12, description="simulation h3 cell resolution")


@app.post("/predict")
async def predict(payload: PredictRequest) -> JSONResponse:
    """
    Predicts Meshtastic signal coverage using the ITM model.

    This endpoint accepts input parameters including the transmitter and
    receiver characteristics (latitude, longitude, height, gain, etc.) as well
    as a region code. Based on this information, it calculates the predicted
    signal coverage over a geographical area using the ITM (Irregular Terrain
    Model).

    The prediction is returned as a GeoJSON FeatureCollection, where each feature
    represents an H3 hexagon covering part of the region, and the properties
    include the predicted signal strength (RSSI) in dBm.

    Parameters:
    ----------
    payload: PredictRequest
        A Pydantic model containing the following parameters:
        - lat: float, latitude of the transmitter (-90 to 90 degrees)
        - lon: float, longitude of the transmitter (-180 to 180 degrees)
        - txh: float, height of the transmitter in meters (must be greater than 0)
        - rxh: float, height of the receiver in meters (must be greater than 0)
        - tx_gain: float, gain of the transmitter antenna in dB
        - rx_gain: float, gain of the receiver antenna in dB
        - region: str, Meshtastic region code (must be one of the valid region codes from regions.py)
        - resolution: int, H3 resolution (must be between 7 and 12)

    Returns:
    --------
    JSONResponse
        A JSON response containing a GeoJSON FeatureCollection of predicted
        signal coverage, where each feature's properties include:
        - model_rssi: float, the predicted RSSI in dBm.

    Raises:
    -------
    HTTPException
        - 404: If the specified meshtastic region is not found.
        - 400: If there is an error during model calculation.

    Example:
    --------
    {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[lon1, lat1], [lon2, lat2], ...]]
                },
                "properties": {
                    "model_rssi": -80.5
                }
            },
            ...
        ]
    }
    """

    logging.info(f"Received prediction request: {payload.dict()}")
    if payload.region not in meshtastic_regions.keys():
        logging.error(f"Region {payload.region} is not valid.")
        raise HTTPException(
            status_code=404, detail=f"Region '{payload.region}' not found"
        )
    start_time = time.time()
    try:
        center = Point(payload.lat, payload.lon, payload.txh)
        prediction_h3 = itm.coverage(
            center,
            config["h3_res"],
            meshtastic_regions[payload.region]["frequency"] * 1e6,  # must be in MHz
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
    logging.info(f"ITM model calculation completed successfully in {duration:.2f} seconds.")

    tx_power = meshtastic_regions[payload.region][
        "transmit_power"
    ]  # assume the maximum permitted transmit power for the region

    features = []
    for row in prediction_h3:
        hex_boundary = h3.h3_to_geo_boundary(hex(row[0]), geo_json=True)

        loss_db = row[2]
        model_rssi = (
            tx_power + payload.tx_gain + payload.rx_gain - loss_db
        )  # simple approximation, ignores other losses such as cables

        features.append(
            geojson.Feature(
                geometry=geojson.Polygon([hex_boundary]),
                properties={"model_rssi": model_rssi},
            )
        )

    feature_collection = geojson.FeatureCollection(features)

    return JSONResponse(content=feature_collection)


@app.get("/")
def serve_frontend():
    """
    Serves the index.html file as the frontend for the app.
    """
    return FileResponse("index.html")
