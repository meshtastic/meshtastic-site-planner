/* Georeferenced coverage export (#64).
 *
 * Three formats, all from the in-memory dBm grid:
 *  - GeoJSON  — vector signal contours (QGIS, web maps); inherently georef.
 *  - PNG+PGW  — equirectangular raster + ESRI world file (QGIS, generic GIS).
 *  - KML+PNG  — GroundOverlay referencing the PNG (Google Earth).
 *
 * The raster is rendered EQUIRECTANGULAR (one pixel per engine grid cell,
 * lon/lat-linear), NOT the mercator-warped image used for on-screen
 * MapLibre display — because .pgw and KML LatLonBox assume EPSG:4326.
 */

import type { Site } from '../types';
import type { CoverageResult } from '../engine/CoverageEngine';
import { colormapLut } from '../render/colormaps';
import { coverageContours } from './contours';

function slug(name: string): string {
  return (name || 'site').replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'site';
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Colorize the dBm grid to an equirectangular canvas (row 0 = north).
 * Covered pixels are fully opaque; below-sensitivity / no-data transparent. */
function coverageCanvas(site: Site): HTMLCanvasElement {
  const result: CoverageResult = site.result;
  const { width, height, dbm } = result;
  const { color_scale, min_dbm, max_dbm } = site.params.display;
  const sensitivity = site.params.receiver.rx_sensitivity;
  const lut = colormapLut(color_scale);
  const span = max_dbm > min_dbm ? max_dbm - min_dbm : 1;

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = dbm[i];
    if (Number.isNaN(v) || v < sensitivity) continue; // transparent
    let t = (v - min_dbm) / span;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const c = Math.round(t * 255) * 3;
    const o = i * 4;
    rgba[o] = lut[c];
    rgba[o + 1] = lut[c + 1];
    rgba[o + 2] = lut[c + 2];
    rgba[o + 3] = 255;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  );
}

/** ESRI world file (.pgw) for the equirectangular PNG. */
function worldFile(result: CoverageResult): string {
  const { width, height, bounds } = result;
  const a = (bounds.east - bounds.west) / width; // lon per px
  const e = -(bounds.north - bounds.south) / height; // lat per px (down = negative)
  const c = bounds.west + a / 2; // center of top-left px
  const f = bounds.north + e / 2;
  return [a, 0, 0, e, c, f].map((n) => n.toString()).join('\n') + '\n';
}

export function exportGeoJSON(site: Site): void {
  const fc = coverageContours(site.result, {
    colorScale: site.params.display.color_scale,
    minDbm: site.params.display.min_dbm,
    maxDbm: site.params.display.max_dbm,
    sensitivityDbm: site.params.receiver.rx_sensitivity,
  });
  download(`${slug(site.params.transmitter.name)}.geojson`, new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }));
}

export async function exportPngWorldFile(site: Site): Promise<void> {
  const base = slug(site.params.transmitter.name);
  const png = await canvasToPngBlob(coverageCanvas(site));
  download(`${base}.png`, png);
  download(`${base}.pgw`, new Blob([worldFile(site.result)], { type: 'text/plain' }));
}

export async function exportKml(site: Site): Promise<void> {
  const base = slug(site.params.transmitter.name);
  const { bounds } = site.result;
  const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <GroundOverlay>
    <name>${esc(site.params.transmitter.name)} coverage</name>
    <Icon><href>${base}.png</href></Icon>
    <LatLonBox>
      <north>${bounds.north}</north>
      <south>${bounds.south}</south>
      <east>${bounds.east}</east>
      <west>${bounds.west}</west>
    </LatLonBox>
  </GroundOverlay>
</kml>
`;
  const png = await canvasToPngBlob(coverageCanvas(site));
  download(`${base}.png`, png);
  download(`${base}.kml`, new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }));
}
