# Meshtastic Link Planner 

> [!WARNING]
> This repository has been superseded by the Meshtastic Siteplanner (see https://github.com/meshtastic/meshtastic-site-planner). You can visit the hosted version at https://site.meshtastic.org/

## About

This is a web utility to predict the range of a Meshtastic radio (see http://meshtastic.org). It generates a map of where your Meshtastic radio can be received based on your location and antenna. The prediction accounts for terrain and calculates the expected RSSI (received signal strength indication) using the ITM / Longley-Rice model. The model parameters have been carefully chosen based on experimental data and practical experience to produce results which are accurate for Meshtastic devices. The transmit power and frequency are based on the selected LoRa region. 

## Assumptions

This tool makes several assumptions:

* Receivers are 1 meter above the ground and have an antenna gain of 1.0 dB.
* There are no signal losses caused by obstructions other than terrain. This includes trees, buildings, and glass windows.
* Antennas are isotropic and vertically polarized.
* Negligible signal losses are caused by coaxial cable.
* Radios are transmitting the maximum legal power permitted in their region.
* The sensitivity of the receiver in all cases is approximately -130 dBm.
* The terrain model is accurate to 30 meters.
* In the hosted version, signals do not travel farther than 100 kilometers.

These assumptions have been tested and found to be practical in typical usage scenarios. Please use discretion and verify the predictions this tool makes.


## Building

**Warning: SRTM dataset download instructions out of date.**

The below S3 bucket does not contain the tiles you need. An alternative solution is being developed currrently.

Requirements:

* 3 arcsecond resolution NASA SRTM elevation dataset in `.hgt` format, available from https://registry.opendata.aws/terrain-tiles/
* docker
* git

copy the `.hgt` files to a convenient folder, `my_srtm_data`.

```
git clone --recurse-submodules https://github.com/mrpatrick1991/meshtastic_linkplanner/ && cd meshtastic_linkplanner

docker build -t linkplanner .

docker run --env h3_res=8 \
           --env max_distance_km=100 \
           --env tile_dir=/app/srtm_tiles \
           -v my_srtm_data:/app/srtm_tiles \
           -p 8080:8080 linkplanner
```

Note: It is recommended to leave the `max_distance` at 100 kilometers and `h3_res` as 8 so that the computation is fast.

## Disclaimer

Follow local radio communication laws. Some Meshtastic projects may require an amateur radio license. 

## References

* geoprop-py: https://github.com/JayKickliter/geoprop-py
* LeafletJS: https://leafletjs.com
* ITM / Longley-Rice model: https://its.ntia.gov/software/itm
* Meshtastic: https://meshtastic.org

## License 
This program is free and open-source software licensed under the MIT License. Please see the LICENSE file for details.

That means you have the right to study, change, and distribute the software and source code to anyone and for any purpose. You deserve these rights.

