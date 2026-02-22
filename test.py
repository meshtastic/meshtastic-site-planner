"""
Tests for the Signal Propagation Prediction API.

The API has three endpoints:
  POST /coverage/h3      - area coverage as H3 hexagon GeoJSON
  POST /coverage/contour - area coverage as contour band GeoJSON
  POST /link             - point-to-point path loss with terrain profile

All endpoints accept ITM model parameters (climate, polarization, etc.)
and return JSON. Coverage endpoints return GeoJSON FeatureCollections.

Run with: pytest test.py -v
"""

from fastapi.testclient import TestClient
from api import api

client = TestClient(api)

# -- Shared test payloads --

# San Francisco, 906.875 MHz Meshtastic default, 10m tx antenna
COVERAGE_PAYLOAD = {
    "lat": 37.7749,
    "lon": -122.4194,
    "frequency": 906.875,
    "txh": 10.0,
    "rxh": 1.5,
    "resolution": 8,
}

# SF to Oakland link, with explicit ITM parameters
LINK_PAYLOAD = {
    "tx_lat": 37.7749,
    "tx_lon": -122.4194,
    "txh": 10.0,
    "rx_lat": 37.8044,
    "rx_lon": -122.2712,
    "rxh": 1.5,
    "frequency": 906.875,
    "climate": "maritime_temperate_over_land",
    "pol": "vertical",
}


# ---- /coverage/h3 ----
# Returns a GeoJSON FeatureCollection of H3 hexagon polygons,
# each with a "loss_db" property (path loss in dB at that cell).


def test_coverage_h3():
    """H3 coverage returns a FeatureCollection of hex polygons with loss values."""
    response = client.post("/coverage/h3", json=COVERAGE_PAYLOAD)
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) > 0

    feature = data["features"][0]
    assert feature["geometry"]["type"] == "Polygon"
    assert "loss_db" in feature["properties"]
    assert isinstance(feature["properties"]["loss_db"], (int, float))


def test_coverage_h3_with_itm_params():
    """All optional ITM parameters are accepted and don't break the response."""
    payload = {
        **COVERAGE_PAYLOAD,
        "climate": "continental_temperate",
        "pol": "vertical",
        "n0": 301.0,
        "epsilon": 15.0,
        "sigma": 0.005,
        "mdvar": "mobile",
        "time": 95.0,
        "location": 95.0,
        "situation": 95.0,
    }
    response = client.post("/coverage/h3", json=payload)
    assert response.status_code == 200
    assert response.json()["type"] == "FeatureCollection"


def test_coverage_h3_invalid_lat():
    """Latitude outside -90..90 is rejected by pydantic validation (422)."""
    response = client.post(
        "/coverage/h3",
        json={"lat": 100.0, "lon": -122.4194, "frequency": 906.875},
    )
    assert response.status_code == 422


def test_coverage_h3_missing_frequency():
    """Frequency is required; omitting it returns 422."""
    response = client.post(
        "/coverage/h3",
        json={"lat": 37.7749, "lon": -122.4194},
    )
    assert response.status_code == 422


def test_coverage_h3_invalid_resolution():
    """Resolution must be 7-12; out-of-range is rejected."""
    payload = {**COVERAGE_PAYLOAD, "resolution": 3}
    response = client.post("/coverage/h3", json=payload)
    assert response.status_code == 422


def test_coverage_h3_invalid_climate():
    """Invalid climate enum value is rejected."""
    payload = {**COVERAGE_PAYLOAD, "climate": "martian"}
    response = client.post("/coverage/h3", json=payload)
    assert response.status_code == 422


# ---- /coverage/contour ----
# Returns a GeoJSON FeatureCollection of MultiPolygon contour bands,
# each with "min_db" and "max_db" properties defining the loss range.


def test_coverage_contour():
    """Contour coverage returns MultiPolygon bands with dB range properties."""
    response = client.post("/coverage/contour", json=COVERAGE_PAYLOAD)
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) > 0

    feature = data["features"][0]
    assert feature["geometry"]["type"] == "MultiPolygon"
    assert "min_db" in feature["properties"]
    assert "max_db" in feature["properties"]
    # Bands should be ordered: min < max
    assert feature["properties"]["min_db"] < feature["properties"]["max_db"]


def test_coverage_contour_same_input_as_h3():
    """Contour, grid, and H3 endpoints accept the same payload schema."""
    for endpoint in ["/coverage/h3", "/coverage/grid", "/coverage/contour"]:
        response = client.post(endpoint, json=COVERAGE_PAYLOAD)
        assert response.status_code == 200
        assert response.json()["type"] == "FeatureCollection"


# ---- /coverage/grid ----
# Returns a GeoJSON FeatureCollection of Point features at each H3 cell centroid,
# each with a "loss_db" property. Lighter than /coverage/h3 (no polygon geometry).


def test_coverage_grid():
    """Grid coverage returns Point features at H3 cell centroids with loss values."""
    response = client.post("/coverage/grid", json=COVERAGE_PAYLOAD)
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) > 0

    feature = data["features"][0]
    assert feature["geometry"]["type"] == "Point"
    # GeoJSON Point coordinates are [lon, lat]
    coords = feature["geometry"]["coordinates"]
    assert len(coords) == 2
    assert -180 <= coords[0] <= 180  # lon
    assert -90 <= coords[1] <= 90    # lat
    assert "loss_db" in feature["properties"]
    assert isinstance(feature["properties"]["loss_db"], (int, float))


# ---- /link ----
# Returns path loss (dB), distance (m), terrain profile, and distance array
# for a single transmitter-receiver pair.


def test_link():
    """Link endpoint returns loss, distance, and terrain profile arrays."""
    response = client.post("/link", json=LINK_PAYLOAD)
    assert response.status_code == 200
    data = response.json()

    # Path loss in dB — should be a positive number for any real-world path
    assert "loss_db" in data
    assert isinstance(data["loss_db"], (int, float))

    # Total distance between tx and rx in meters
    assert "distance_m" in data
    assert data["distance_m"] > 0

    # Terrain elevation samples along the path (meters above sea level)
    assert "terrain_profile_m" in data
    assert isinstance(data["terrain_profile_m"], list)
    assert len(data["terrain_profile_m"]) > 0

    # Cumulative distances corresponding to each terrain sample
    assert "distances_m" in data
    assert len(data["distances_m"]) == len(data["terrain_profile_m"])


def test_link_defaults():
    """Only required fields (coords + frequency); heights default to 1.0m."""
    response = client.post(
        "/link",
        json={
            "tx_lat": 37.7749,
            "tx_lon": -122.4194,
            "rx_lat": 37.8044,
            "rx_lon": -122.2712,
            "frequency": 906.875,
        },
    )
    assert response.status_code == 200
    assert "loss_db" in response.json()


def test_link_invalid_climate():
    """Invalid climate enum value is rejected."""
    payload = {**LINK_PAYLOAD, "climate": "invalid_climate"}
    response = client.post("/link", json=payload)
    assert response.status_code == 422


def test_link_missing_rx():
    """Receiver coordinates are required; omitting them returns 422."""
    response = client.post(
        "/link",
        json={
            "tx_lat": 37.7749,
            "tx_lon": -122.4194,
            "frequency": 906.875,
        },
    )
    assert response.status_code == 422


def test_link_invalid_frequency():
    """Frequency must be >50 MHz (ITM limitation)."""
    payload = {**LINK_PAYLOAD, "frequency": 10.0}
    response = client.post("/link", json=payload)
    assert response.status_code == 422