# Meshtastic Site Planner 

## About

This is a web utility to predict the range of a Meshtastic radio (see http://meshtastic.org). It generates a map of where your Meshtastic radio can be received based on your location and antenna. The prediction accounts for terrain and calculates the expected RSSI (received signal strength indication) using the ITM / Longley-Rice model. 

## Building

Requirements:

* 3 arcsecond resolution NASA SRTM elevation dataset in `.hgt` format, available from https://huggingface.co/datasets/mpatrick1991/srtm-3-arc-second-global 
* docker
* git

Copy the terrain tiles (17.7 GB download, 75.48 GB uncompressed) to a convenient folder by running:

```mkdir -p /path/to/srtm/tiles && curl -L https://huggingface.co/datasets/mpatrick1991/srtm-3-arc-second-global/resolve/main/srtm.tar.gz | tar xzf - -C tiles/ --strip-components=2```

Clone the repository:

```git clone --recurse-submodules https://github.com/mrpatrick1991/meshtastic_linkplanner/ && cd meshtastic_siteplanner```

Copy the `.env.example` file to `.env` and change `tile_dir` to point to the above folder:

```cp .env.example .env```

Build using docker-compose:

```
docker-compose up --build
```


## References

* geoprop-py: https://github.com/JayKickliter/geoprop-py
* LeafletJS: https://leafletjs.com
* ITM / Longley-Rice model: https://its.ntia.gov/software/itm
* Meshtastic: https://meshtastic.org