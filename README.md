# Meshtastic Site Planner

A web tool for predicting [Meshtastic](https://meshtastic.org) radio coverage. Given a location and antenna configuration, it generates an RF coverage map using the ITM (Longley-Rice) propagation model with terrain data.

## Prerequisites

- Docker & Docker Compose
- Git
- 3 arc-second NASA SRTM elevation tiles (`.hgt` format) — available from [Hugging Face](https://huggingface.co/datasets/mpatrick1991/srtm-3-arc-second-global) (17.7 GB compressed, ~75.5 GB uncompressed)

## Setup

**1. Download terrain tiles:**

```sh
mkdir -p tiles && curl -L https://huggingface.co/datasets/mpatrick1991/srtm-3-arc-second-global/resolve/main/srtm.tar.gz | tar xzf - -C tiles/ --strip-components=2
```

**2. Clone the repository:**

```sh
git clone --recurse-submodules https://github.com/mrpatrick1991/meshtastic_linkplanner/ && cd meshtastic_linkplanner
```

**3. Configure environment:**

Copy `.env.example` to `.env` and set `tile_dir` to the path of your `tiles/` folder.

**4. Build and run:**

```sh
docker-compose up --build
```

## References

- [geoprop-py](https://github.com/JayKickliter/geoprop-py)
- [Leaflet](https://leafletjs.com)
- [ITM / Longley-Rice model](https://its.ntia.gov/software/itm)
- [Meshtastic](https://meshtastic.org)