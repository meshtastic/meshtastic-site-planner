from fastapi.testclient import TestClient
from api import api

client = TestClient(api)


def test_area():
    response = client.post(
        "/area",
        json={
            "lat": 37.7749,
            "lon": -122.4194,
            "frequency": 915.0,
            "climate": "continental_temperate",
            "pol": "vertical",
            "n0": 301.0,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) > 0
    assert "loss_db" in data["features"][0]["properties"]


def test_area_invalid_lat():
    response = client.post(
        "/area",
        json={"lat": 100.0, "lon": -122.4194, "frequency": 915.0},
    )
    assert response.status_code == 422


def test_p2p():
    response = client.post(
        "/p2p",
        json={
            "tx_lat": 37.7749,
            "tx_lon": -122.4194,
            "txh": 10.0,
            "rx_lat": 37.8044,
            "rx_lon": -122.2712,
            "rxh": 2.0,
            "frequency": 915.0,
            "climate": "maritime_temperate_over_sea",
            "pol": "horizontal",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "loss_db" in data
    assert isinstance(data["loss_db"], (int, float))
    assert "distance_m" in data
    assert isinstance(data["distance_m"], (int, float))
    assert data["distance_m"] > 0
    assert "terrain_profile_m" in data
    assert isinstance(data["terrain_profile_m"], list)
    assert len(data["terrain_profile_m"]) > 0
    assert "distances_m" in data
    assert isinstance(data["distances_m"], list)
    assert len(data["distances_m"]) == len(data["terrain_profile_m"])


def test_p2p_invalid_climate():
    response = client.post(
        "/p2p",
        json={
            "tx_lat": 37.7749,
            "tx_lon": -122.4194,
            "txh": 10.0,
            "rx_lat": 37.8044,
            "rx_lon": -122.2712,
            "rxh": 2.0,
            "frequency": 915.0,
            "climate": "invalid_climate",
        },
    )
    assert response.status_code == 422
