/* MapLibre basemaps. Same raster providers the Leaflet version used (CARTO
 * retina + Esri hybrids), defined as plain raster-source specs so they can
 * be swapped IN PLACE rather than via setStyle().
 *
 * Swapping the whole style (map.setStyle) tears down and rebuilds all GL
 * resources; in practice that left raster basemaps failing to re-fetch
 * their tiles after the first switch. Instead we keep one style for the
 * map's whole lifetime and only add/remove the basemap's raster
 * source+layer, which is faster (no flash) and avoids that teardown. */

import type { RasterSourceSpecification, StyleSpecification } from 'maplibre-gl';

const CARTO_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const ESRI_IMG_ATTR =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics';

function cartoTiles(style: string): string[] {
  return ['a', 'b', 'c', 'd'].map(
    (s) => `https://${s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}@2x.png`
  );
}

function esriTiles(service: string): string[] {
  return [
    `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`,
  ];
}

/** A basemap is one or more stacked raster sources (e.g. imagery + labels).
 * Each entry's id is suffixed per-basemap so multiple never collide. */
export interface BasemapLayerSpec {
  source: RasterSourceSpecification;
}

export const BASEMAPS: Record<string, BasemapLayerSpec[]> = {
  Dark: [{ source: raster(cartoTiles('dark_all'), 512, CARTO_ATTR) }],
  Streets: [{ source: raster(cartoTiles('rastertiles/voyager'), 512, CARTO_ATTR) }],
  Light: [{ source: raster(cartoTiles('light_all'), 512, CARTO_ATTR) }],
  Satellite: [
    { source: raster(esriTiles('World_Imagery'), 256, ESRI_IMG_ATTR, 19) },
    { source: raster(esriTiles('Reference/World_Boundaries_and_Places'), 256, 'Labels &copy; Esri', 19) },
  ],
  Terrain: [
    { source: raster(esriTiles('Elevation/World_Hillshade'), 256, 'Hillshade &copy; Esri &mdash; Source: USGS, NASA SRTM', 16) },
    { source: raster(cartoTiles('rastertiles/voyager_only_labels'), 512, CARTO_ATTR) },
  ],
};

function raster(
  tiles: string[],
  tileSize: number,
  attribution: string,
  maxzoom?: number
): RasterSourceSpecification {
  return { type: 'raster', tiles, tileSize, attribution, ...(maxzoom ? { maxzoom } : {}) };
}

export const DEFAULT_BASEMAP = 'Dark';

/** Stable id prefix for basemap sources/layers so they can be found+removed. */
export const BASEMAP_PREFIX = 'basemap-';

/** Minimal style; the actual basemap is applied in-place via applyBasemap. */
export function emptyStyle(): StyleSpecification {
  return { version: 8, sources: {}, layers: [] };
}

/**
 * Swap the basemap in place: remove any existing basemap source/layers and
 * add the requested one. Basemap layers are inserted BELOW everything else
 * (beforeId = the lowest non-basemap layer) so coverage overlays stay on top.
 */
export function applyBasemap(map: import('maplibre-gl').Map, name: string): void {
  const specs = BASEMAPS[name] ?? BASEMAPS[DEFAULT_BASEMAP];

  // Remove previous basemap layers + sources.
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.id.startsWith(BASEMAP_PREFIX)) map.removeLayer(layer.id);
  }
  for (const sourceId of Object.keys(map.getStyle().sources ?? {})) {
    if (sourceId.startsWith(BASEMAP_PREFIX)) map.removeSource(sourceId);
  }

  // First remaining (non-basemap) layer; new basemap layers go beneath it.
  const beforeId = (map.getStyle().layers ?? []).find(
    (l) => !l.id.startsWith(BASEMAP_PREFIX)
  )?.id;

  specs.forEach((spec, i) => {
    const id = `${BASEMAP_PREFIX}${i}`;
    map.addSource(id, spec.source);
    map.addLayer({ id, type: 'raster', source: id }, beforeId);
  });
}
