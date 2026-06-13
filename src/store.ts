import { defineStore } from 'pinia';
// import { useLocalStorage } from '@vueuse/core';
import { randanimalSync } from 'randanimal';
import maplibregl from 'maplibre-gl';
import { type Site, type SplatParams } from './types.ts';
import { cloneObject } from './utils.ts';
import { draftPinElement, sitePinElement, targetPinElement } from './layers.ts';
import { BASEMAPS, DEFAULT_BASEMAP, applyBasemap, emptyStyle } from './map/styles.ts';
import { BasemapControl, ExportControl, MeasureControl } from './map/controls.ts';
import { SearchControl } from './map/search.ts';
import { coverageImage, cropToRadius } from './map/overlay.ts';
import { coverageContours } from './map/contours.ts';
import { exportGeoJSON, exportKml, exportPngWorldFile } from './map/export.ts';
import { WasmCoverageEngine } from './engine/WasmCoverageEngine.ts';
import type { CoverageProgress } from './engine/CoverageEngine.ts';
import { toEngineParams, type CoverageRequest, METERS_PER_FOOT, MAX_RADIUS_METERS } from './engine/params.ts';
import { analyzeLink, type LinkAnalysis } from './engine/link.ts';
import { loadParams, mergeParams, saveParams } from './persist.ts';
import { decodeSharedHash, buildShareUrl, clearSharedHash } from './permalink.ts';
import { coverageStats } from './coverageStats.ts';
import { TerrainService } from './terrain/TerrainService.ts';

// Module-level singletons: workers, terrain cache, and map handles outlive
// store hot-reloads and never need to be reactive.
let engine: WasmCoverageEngine | undefined;
let terrain: TerrainService | undefined;
let abortController: AbortController | undefined;
let map: maplibregl.Map | undefined;
let currentMarker: maplibregl.Marker | undefined;
const siteMarkers = new Map<string, maplibregl.Marker>();
// Active only while "place on map" is armed.
let placeEscHandler: ((e: KeyboardEvent) => void) | undefined;
let placeClickHandler: ((e: maplibregl.MapMouseEvent) => void) | undefined;
// Point-to-point link mode (#14): target marker, arming handlers, in-flight run.
let targetMarker: maplibregl.Marker | undefined;
let linkEscHandler: ((e: KeyboardEvent) => void) | undefined;
let linkClickHandler: ((e: maplibregl.MapMouseEvent) => void) | undefined;
let linkAbort: AbortController | undefined;
const LINK_LINE_ID = 'mt-p2p-link';
// Measure/ruler tool (#15).
let measureControl: MeasureControl | undefined;
let measureClickHandler: ((e: maplibregl.MapMouseEvent) => void) | undefined;
let measureEscHandler: ((e: KeyboardEvent) => void) | undefined;
let measureA: { lat: number; lon: number } | null = null;
const MEASURE_SRC = 'mt-measure';

/** Wrap a longitude into [-180, 180). */
function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Great-circle distance in km (for sizing the link's terrain region). */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing from A to B, degrees (0 = north, clockwise). */
function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function getEngine(): WasmCoverageEngine {
  engine ??= new WasmCoverageEngine();
  return engine;
}

function getTerrain(): TerrainService {
  terrain ??= new TerrainService();
  return terrain;
}

/** Map popup DOM for a simulated site: parameters + georeferenced export
 * buttons (#64). Built as a DOM element so the export buttons can be wired
 * directly. */
function buildSitePopup(site: Site): HTMLElement {
  const t = site.params.transmitter;
  const s = site.stats;
  const km2 = s.areaKm2 >= 100 ? String(Math.round(s.areaKm2)) : s.areaKm2.toFixed(1);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const el = document.createElement('div');
  el.className = 'mt-popup';
  el.innerHTML = `
    <div class="mt-popup-title">${esc(t.name)}</div>
    <div class="mt-popup-row"><span>Frequency</span><span>${t.tx_freq} MHz</span></div>
    <div class="mt-popup-row"><span>Power</span><span>${t.tx_power} W</span></div>
    <div class="mt-popup-row"><span>Antenna height</span><span>${t.tx_height} m</span></div>
    <div class="mt-popup-row"><span>Plot radius</span><span>${site.params.simulation.simulation_extent} km</span></div>
    <div class="mt-popup-row"><span>Coverage (≥ ${s.thresholdDbm} dBm)</span><span>${km2} km²</span></div>
    <div class="mt-popup-row"><span>Max usable range</span><span>${s.maxRangeKm.toFixed(1)} km</span></div>
    <div class="mt-popup-row"><span>Disk covered</span><span>${Math.round(s.coveredFraction * 100)}%</span></div>
    <div class="mt-popup-export">
      <span>Export</span>
      <button type="button" data-fmt="geojson">GeoJSON</button>
      <button type="button" data-fmt="png">PNG</button>
      <button type="button" data-fmt="kml">KML</button>
    </div>`;
  el.querySelectorAll<HTMLButtonElement>('button[data-fmt]').forEach((b) =>
    b.addEventListener('click', () => {
      const fmt = b.dataset.fmt;
      if (fmt === 'geojson') exportGeoJSON(site);
      else if (fmt === 'png') void exportPngWorldFile(site);
      else if (fmt === 'kml') void exportKml(site);
    })
  );
  return el;
}

/** The legacy /predict payload shape, now consumed locally. */
function buildCoverageRequest(p: SplatParams): CoverageRequest {
  return {
    lat: p.transmitter.tx_lat,
    lon: p.transmitter.tx_lon,
    tx_height: p.transmitter.tx_height,
    tx_power: 10 * Math.log10(p.transmitter.tx_power) + 30, // W -> dBm
    tx_gain: p.transmitter.tx_gain,
    system_loss: p.receiver.rx_loss,
    frequency_mhz: p.transmitter.tx_freq,
    rx_height: p.receiver.rx_height,
    clutter_height: p.environment.clutter_height,
    ground_dielectric: p.environment.ground_dielectric,
    ground_conductivity: p.environment.ground_conductivity,
    atmosphere_bending: p.environment.atmosphere_bending,
    radio_climate: p.environment.radio_climate,
    polarization: p.environment.polarization,
    radius: p.simulation.simulation_extent * 1000, // km -> m
    situation_fraction: p.simulation.situation_fraction,
    time_fraction: p.simulation.time_fraction,
    high_resolution: p.simulation.high_resolution,
  };
}

/** Fresh factory-default site parameters (new object each call so callers
 * never share nested references; the site name is randomized per call). */
function defaultParams(): SplatParams {
  return {
    transmitter: {
      name: randanimalSync(),
      tx_lat: 51.102167,
      tx_lon: -114.098667,
      tx_power: 0.1,
      tx_freq: 907.0,
      tx_height: 2.0,
      tx_gain: 2.0,
    },
    receiver: { rx_sensitivity: -130.0, rx_height: 1.0, rx_gain: 2.0, rx_loss: 2.0 },
    environment: {
      radio_climate: 'continental_temperate',
      polarization: 'vertical',
      clutter_height: 1.0,
      ground_dielectric: 15.0,
      ground_conductivity: 0.005,
      atmosphere_bending: 301.0,
    },
    simulation: {
      situation_fraction: 95.0,
      time_fraction: 95.0,
      simulation_extent: 30.0,
      high_resolution: false,
    },
    display: { color_scale: 'plasma', min_dbm: -130.0, max_dbm: -80.0, overlay_transparency: 50 },
  };
}

/** Initial params: a shared permalink (#9) wins over the persisted params
 * (#12), which win over the factory defaults. */
function initialParams(): SplatParams {
  const d = defaultParams();
  const shared = decodeSharedHash();
  return shared ? mergeParams(d, shared) : loadParams(d);
}

const useStore = defineStore('store', {
  state() {
    return {
      localSites: [] as Site[], //useLocalStorage('localSites', ),
      simulationState: 'idle',
      progress: null as CoverageProgress | null,
      errorMessage: '' as string,
      /** True while "place on map" is armed (drives crosshair + hint). */
      placingMode: false,
      /** Live, global render style for every coverage overlay. */
      overlayStyle: 'heatmap' as 'heatmap' | 'contours',
      /** Point-to-point link mode (#14). */
      linkTarget: null as { lat: number; lon: number } | null,
      linkAnalysis: null as LinkAnalysis | null,
      linkAzimuthDeg: 0,
      linkState: 'idle' as 'idle' | 'placing' | 'computing' | 'done' | 'error',
      linkError: '' as string,
      /** Find-highpoint (#39) status. */
      highpointBusy: false,
      highpointMessage: '' as string,
      // Restore from a shared link (#9) or the last-used params (#12).
      splatParams: initialParams(),
      /** Transient "Copied!" feedback for the share button (#9). */
      shareCopied: false,
      /** Measure/ruler tool (#15). */
      measureMode: false,
      measureResult: null as { distanceKm: number; bearingDeg: number } | null,
    }
  },
  actions: {
    /** Non-reactive map handle for components (markers, click handlers). */
    getMap(): maplibregl.Map | undefined {
      return map;
    },
    setTxCoords(lat: number, lon: number) {
      this.splatParams.transmitter.tx_lat = lat
      this.splatParams.transmitter.tx_lon = lon
    },
    /** Place or move the draggable draft transmitter marker. */
    setDraftMarker(lat: number, lon: number) {
      if (!map) return;
      if (currentMarker) {
        currentMarker.setLngLat([lon, lat]);
        return;
      }
      currentMarker = new maplibregl.Marker({
        element: draftPinElement(),
        anchor: 'bottom',
        draggable: true,
      })
        .setLngLat([lon, lat])
        .addTo(map);
      // Dragging the pin updates the transmitter coordinates live.
      currentMarker.on('dragend', () => {
        const ll = currentMarker!.getLngLat();
        const lng = ((((ll.lng + 180) % 360) + 360) % 360) - 180;
        this.setTxCoords(Number(ll.lat.toFixed(6)), Number(lng.toFixed(6)));
      });
    },
    clearDraftMarker() {
      currentMarker?.remove();
      currentMarker = undefined;
    },
    /** Arm (or disarm) click-to-place mode: crosshair + Esc to cancel. */
    beginPlaceOnMap() {
      if (!map) return;
      if (this.placingMode) {
        this.cancelPlaceOnMap();
        return;
      }
      this.placingMode = true;
      map.getCanvas().style.cursor = 'crosshair';
      placeClickHandler = (e: maplibregl.MapMouseEvent) => {
        const lng = ((((e.lngLat.lng + 180) % 360) + 360) % 360) - 180;
        this.setTxCoords(Number(e.lngLat.lat.toFixed(6)), Number(lng.toFixed(6)));
        this.setDraftMarker(e.lngLat.lat, lng);
        this.cancelPlaceOnMap();
      };
      map.on('click', placeClickHandler);
      placeEscHandler = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') this.cancelPlaceOnMap();
      };
      window.addEventListener('keydown', placeEscHandler);
    },
    cancelPlaceOnMap() {
      this.placingMode = false;
      if (map) map.getCanvas().style.cursor = '';
      if (placeClickHandler) {
        map?.off('click', placeClickHandler);
        placeClickHandler = undefined;
      }
      if (placeEscHandler) {
        window.removeEventListener('keydown', placeEscHandler);
        placeEscHandler = undefined;
      }
    },

    /* ---- Point-to-point link mode (#14) ---- */
    /** Arm click-to-place for the link target (crosshair + Esc to cancel). */
    beginPlaceTarget() {
      if (!map) return;
      if (this.linkState === 'placing') {
        this.cancelPlaceTarget();
        return;
      }
      this.cancelPlaceOnMap(); // never arm both at once
      this.linkState = 'placing';
      map.getCanvas().style.cursor = 'crosshair';
      linkClickHandler = (e: maplibregl.MapMouseEvent) => {
        const lon = wrapLon(e.lngLat.lng);
        this.cancelPlaceTarget();
        this.setLinkTarget(Number(e.lngLat.lat.toFixed(6)), Number(lon.toFixed(6)));
      };
      map.on('click', linkClickHandler);
      linkEscHandler = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') this.cancelPlaceTarget();
      };
      window.addEventListener('keydown', linkEscHandler);
    },
    cancelPlaceTarget() {
      if (this.linkState === 'placing')
        this.linkState = this.linkAnalysis ? 'done' : 'idle';
      if (map) map.getCanvas().style.cursor = '';
      if (linkClickHandler) {
        map?.off('click', linkClickHandler);
        linkClickHandler = undefined;
      }
      if (linkEscHandler) {
        window.removeEventListener('keydown', linkEscHandler);
        linkEscHandler = undefined;
      }
    },
    /** Set or move the link target, then (re)compute the link. */
    setLinkTarget(lat: number, lon: number) {
      this.linkTarget = { lat, lon };
      this.drawLink();
      void this.computeLink();
    },
    async computeLink() {
      if (!this.linkTarget) return;
      linkAbort?.abort();
      linkAbort = new AbortController();
      const signal = linkAbort.signal;
      this.linkState = 'computing';
      this.linkError = '';
      try {
        const request = buildCoverageRequest(this.splatParams);
        // The engine region is a disk around the TX; widen the radius so it
        // reaches the target (plus margin), capped at the terrain-data limit.
        const distKm = haversineKm(request.lat, request.lon, this.linkTarget.lat, this.linkTarget.lon);
        request.radius = Math.min(MAX_RADIUS_METERS, (distKm * 1.2 + 2) * 1000);
        request.high_resolution = false; // a single path doesn't need HD pages
        const params = toEngineParams(request);
        const target = {
          lat: this.linkTarget.lat,
          lon: this.linkTarget.lon,
          altFeet: this.splatParams.receiver.rx_height / METERS_PER_FOOT,
        };
        const link = await getEngine().runLink(params, target, { terrain: getTerrain(), signal });
        if (signal.aborted) return;
        this.linkAzimuthDeg = link.azimuthDeg;
        this.linkAnalysis = analyzeLink({
          profile: link.profile,
          txHeightM: this.splatParams.transmitter.tx_height,
          rxHeightM: this.splatParams.receiver.rx_height,
          frequencyMhz: this.splatParams.transmitter.tx_freq,
          dbm: link.dbm,
          rxGainDbi: this.splatParams.receiver.rx_gain,
          rxSensitivityDbm: this.splatParams.receiver.rx_sensitivity,
        });
        this.linkState = 'done';
        this.drawLink(); // recolor the line by viability
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        this.linkError = error instanceof Error ? error.message : String(error);
        this.linkState = 'error';
      }
    },
    clearLink() {
      linkAbort?.abort();
      this.cancelPlaceTarget();
      this.linkTarget = null;
      this.linkAnalysis = null;
      this.linkState = 'idle';
      this.linkError = '';
      targetMarker?.remove();
      targetMarker = undefined;
      if (map?.getLayer(LINK_LINE_ID)) map.removeLayer(LINK_LINE_ID);
      if (map?.getSource(LINK_LINE_ID)) map.removeSource(LINK_LINE_ID);
    },
    /** Draw or update the target marker and the TX->target line. */
    drawLink() {
      if (!map || !this.linkTarget) return;
      const tx = this.splatParams.transmitter;
      const tgt = this.linkTarget;
      if (targetMarker) {
        targetMarker.setLngLat([tgt.lon, tgt.lat]);
      } else {
        targetMarker = new maplibregl.Marker({ element: targetPinElement(), anchor: 'bottom', draggable: true })
          .setLngLat([tgt.lon, tgt.lat])
          .addTo(map);
        targetMarker.on('dragend', () => {
          const ll = targetMarker!.getLngLat();
          this.setLinkTarget(Number(ll.lat.toFixed(6)), Number(wrapLon(ll.lng).toFixed(6)));
        });
      }
      const a = this.linkAnalysis;
      const color = !a
        ? '#9aa0aa'
        : a.marginDb >= 0 && a.fresnelClear
          ? '#67ea94'
          : a.marginDb >= 0
            ? '#f5c518'
            : '#ff5c5c';
      const geojson = {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [tx.tx_lon, tx.tx_lat],
            [tgt.lon, tgt.lat],
          ],
        },
        properties: {},
      };
      const draw = () => {
        if (!map) return;
        const src = map.getSource(LINK_LINE_ID) as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(geojson);
          map.setPaintProperty(LINK_LINE_ID, 'line-color', color);
        } else {
          map.addSource(LINK_LINE_ID, { type: 'geojson', data: geojson });
          map.addLayer({
            id: LINK_LINE_ID,
            type: 'line',
            source: LINK_LINE_ID,
            layout: { 'line-cap': 'round' },
            paint: { 'line-color': color, 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
          });
        }
      };
      // addSource/addLayer succeed once the style spec is parsed (even while
      // tiles stream and isStyleLoaded() is false); only the brief initial
      // load / a basemap switch can throw, so try now and retry on idle.
      try {
        draw();
      } catch {
        map.once('idle', () => {
          try {
            draw();
          } catch {
            /* ignore */
          }
        });
      }
    },

    /* ---- Find highpoint (#39) ---- */
    /** Move the transmitter to the highest terrain within radiusKm of it. */
    async findHighpoint(radiusKm = 1) {
      if (this.highpointBusy) return;
      this.highpointBusy = true;
      this.highpointMessage = '';
      const ac = new AbortController();
      try {
        const request = buildCoverageRequest(this.splatParams);
        const r = Math.max(0.2, Math.min(10, radiusKm));
        request.radius = r * 1000; // search disk = engine region
        request.high_resolution = false;
        const params = toEngineParams(request);
        const hp = await getEngine().findHighpoint(params, r, {
          terrain: getTerrain(),
          signal: ac.signal,
        });
        const movedM = haversineKm(request.lat, request.lon, hp.lat, hp.lon) * 1000;
        if (movedM < 5) {
          this.highpointMessage = `Already at the local high point (${Math.round(hp.elevationM)} m).`;
        } else {
          this.setTxCoords(Number(hp.lat.toFixed(6)), Number(hp.lon.toFixed(6)));
          this.setDraftMarker(hp.lat, hp.lon);
          map?.flyTo({ center: [hp.lon, hp.lat] });
          this.highpointMessage = `Moved ${Math.round(movedM)} m to a ${Math.round(hp.elevationM)} m high point.`;
        }
      } catch (error) {
        this.highpointMessage =
          error instanceof Error ? error.message : String(error);
      } finally {
        this.highpointBusy = false;
      }
    },

    /* ---- Shareable permalink (#9) ---- */
    /** Copy a link encoding the current parameters to the clipboard. */
    async copyShareLink() {
      const url = buildShareUrl(this.splatParams);
      try {
        await navigator.clipboard.writeText(url);
        this.shareCopied = true;
        setTimeout(() => {
          this.shareCopied = false;
        }, 2000);
      } catch {
        // Clipboard unavailable (e.g. insecure context): show the URL instead.
        window.prompt('Copy this link:', url);
      }
      return url;
    },
    /** If the page opened from a shared link, persist those params and drop the
     * hash so later edits aren't overridden by the link on the next reload. */
    consumeSharedLink() {
      if (decodeSharedHash()) {
        saveParams(this.splatParams);
        clearSharedHash();
      }
    },

    /* ---- Measure / ruler tool (#15) ---- */
    toggleMeasure() {
      if (this.measureMode) {
        this.endMeasure();
        return;
      }
      this.cancelPlaceOnMap();
      this.cancelPlaceTarget();
      this.measureMode = true;
      this.measureResult = null;
      measureA = null;
      measureControl?.setActive(true);
      if (map) map.getCanvas().style.cursor = 'crosshair';
      measureClickHandler = (e: maplibregl.MapMouseEvent) => {
        const lat = e.lngLat.lat;
        const lon = wrapLon(e.lngLat.lng);
        if (!measureA) {
          measureA = { lat, lon };
          this.measureResult = null;
          this.drawMeasure(measureA, null);
        } else {
          const b = { lat, lon };
          this.measureResult = {
            distanceKm: haversineKm(measureA.lat, measureA.lon, b.lat, b.lon),
            bearingDeg: bearingDeg(measureA.lat, measureA.lon, b.lat, b.lon),
          };
          this.drawMeasure(measureA, b);
          measureA = null; // next click starts a new measurement
        }
      };
      map?.on('click', measureClickHandler);
      measureEscHandler = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') this.endMeasure();
      };
      window.addEventListener('keydown', measureEscHandler);
    },
    endMeasure() {
      this.measureMode = false;
      this.measureResult = null;
      measureA = null;
      measureControl?.setActive(false);
      if (map) map.getCanvas().style.cursor = '';
      if (measureClickHandler) {
        map?.off('click', measureClickHandler);
        measureClickHandler = undefined;
      }
      if (measureEscHandler) {
        window.removeEventListener('keydown', measureEscHandler);
        measureEscHandler = undefined;
      }
      if (map?.getLayer(`${MEASURE_SRC}-line`)) map.removeLayer(`${MEASURE_SRC}-line`);
      if (map?.getLayer(`${MEASURE_SRC}-pts`)) map.removeLayer(`${MEASURE_SRC}-pts`);
      if (map?.getSource(MEASURE_SRC)) map.removeSource(MEASURE_SRC);
    },
    drawMeasure(a: { lat: number; lon: number } | null, b: { lat: number; lon: number } | null) {
      if (!map) return;
      const features: GeoJSON.Feature[] = [];
      if (a) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: {} });
      if (b) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [b.lon, b.lat] }, properties: {} });
      if (a && b)
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
          properties: {},
        });
      const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      const draw = () => {
        if (!map) return;
        const src = map.getSource(MEASURE_SRC) as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(fc);
          return;
        }
        map.addSource(MEASURE_SRC, { type: 'geojson', data: fc });
        map.addLayer({
          id: `${MEASURE_SRC}-line`,
          type: 'line',
          source: MEASURE_SRC,
          filter: ['==', ['geometry-type'], 'LineString'],
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': '#67ea94', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
        });
        map.addLayer({
          id: `${MEASURE_SRC}-pts`,
          type: 'circle',
          source: MEASURE_SRC,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 4,
            'circle-color': '#67ea94',
            'circle-stroke-color': '#0f1017',
            'circle-stroke-width': 2,
          },
        });
      };
      // addSource/addLayer succeed once the style spec is parsed (even while
      // tiles stream and isStyleLoaded() is false); only the brief initial
      // load / a basemap switch can throw, so try now and retry on idle.
      try {
        draw();
      } catch {
        map.once('idle', () => {
          try {
            draw();
          } catch {
            /* ignore */
          }
        });
      }
    },

    removeSite(index: number) {
      const [removed] = this.localSites.splice(index, 1)
      if (removed) {
        siteMarkers.get(removed.id)?.remove();
        siteMarkers.delete(removed.id);
        if (map) this.removeOverlay(removed.id);
      }
    },
    /** Show/hide one site's overlay + marker (#61). */
    toggleSiteVisibility(index: number) {
      const site = this.localSites[index];
      if (!site) return;
      site.visible = !site.visible;
      const el = siteMarkers.get(site.id)?.getElement();
      if (el) el.style.display = site.visible ? '' : 'none';
      this.syncOverlays();
    },
    /** Remove every layer/source for one site's overlay (either style). */
    removeOverlay(siteId: string) {
      if (!map) return;
      const id = `coverage-${siteId}`;
      for (const layerId of [`${id}-line`, id]) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      if (map.getSource(id)) map.removeSource(id);
    },
    /** Switch all overlays between the raster heatmap and vector contours. */
    setOverlayStyle(style: 'heatmap' | 'contours') {
      if (this.overlayStyle === style) return;
      this.overlayStyle = style;
      this.syncOverlays();
    },
    /** Live-apply the Display panel to every existing overlay without
     * recomputing (#1). The engine output is cached per site, so re-coloring
     * (and re-thresholding/opacity) is a pure re-render — instant even after a
     * slow HD run. Mirrors the panel onto each site so the list swatches and
     * the on-map legend stay in sync. */
    applyDisplayLive() {
      const d = this.splatParams.display;
      for (const site of this.localSites) Object.assign(site.params.display, d);
      this.syncOverlays();
    },
    /** (Re-)adds every site's overlay in the current style; safe after
     * style switches and idempotent. */
    syncOverlays() {
      if (!map) return;
      // addSource/addLayer throw if the style is mid-load (initial load, or
      // a basemap switch still settling). Defer until the map is idle.
      if (!map.isStyleLoaded()) {
        map.once('idle', () => this.syncOverlays());
        return;
      }
      this.localSites.forEach((site: Site) => {
        const id = `coverage-${site.id}`;
        this.removeOverlay(site.id);
        if (site.visible === false) return; // hidden via the site-list toggle
        const opacity = 1 - site.params.display.overlay_transparency / 100;

        if (this.overlayStyle === 'contours') {
          const geojson = coverageContours(site.result, {
            colorScale: site.params.display.color_scale,
            minDbm: site.params.display.min_dbm,
            maxDbm: site.params.display.max_dbm,
            sensitivityDbm: site.params.receiver.rx_sensitivity,
          });
          map!.addSource(id, { type: 'geojson', data: geojson });
          // Features are ordered weakest→strongest, so the stronger bands
          // paint on top and the visible color is the highest level reached.
          map!.addLayer({
            id,
            type: 'fill',
            source: id,
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': opacity },
          });
          map!.addLayer({
            id: `${id}-line`,
            type: 'line',
            source: id,
            paint: { 'line-color': ['get', 'color'], 'line-width': 0.6, 'line-opacity': Math.min(1, opacity + 0.25) },
          });
        } else {
          const image = coverageImage(
            site.result,
            site.params.display,
            site.params.receiver.rx_sensitivity
          );
          map!.addSource(id, {
            type: 'image',
            url: image.url,
            coordinates: image.coordinates,
          });
          map!.addLayer({
            id,
            type: 'raster',
            source: id,
            paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest' },
          });
        }
      });
    },
    initMap() {
      map = new maplibregl.Map({
        container: 'map',
        // Start from an empty style and add the basemap in place (see
        // src/map/styles.ts for why setStyle-based switching is avoided).
        style: emptyStyle(),
        center: [this.splatParams.transmitter.tx_lon, this.splatParams.transmitter.tx_lat],
        zoom: 9,
        // Needed so the export control can read the WebGL canvas.
        canvasContextAttributes: { preserveDrawingBuffer: true },
        // Default attribution disabled; added explicitly below at bottom-left
        // (the right sidebar would otherwise cover a bottom-right control).
        attributionControl: false,
      });

      map.addControl(new SearchControl(), 'top-left');
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          showUserLocation: true,
        }),
        'bottom-left'
      );
      map.addControl(new ExportControl(), 'bottom-left');
      measureControl = new MeasureControl(() => this.toggleMeasure());
      map.addControl(measureControl, 'bottom-left');
      map.addControl(
        new BasemapControl(Object.keys(BASEMAPS), DEFAULT_BASEMAP, (name) => {
          // Swap the basemap raster source/layers in place (keeps overlays,
          // markers, and the GL context intact).
          if (map) applyBasemap(map, name);
        }),
        'bottom-left'
      );
      // Compact (collapsed to an "i" that expands on click) so the required
      // per-basemap credits — e.g. Stamen Terrain needs four — don't crowd the
      // map. Bottom-left keeps it in the map's always-visible area, clear of
      // the right sidebar. Credits are already per-selected-basemap.
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

      // Apply the default basemap and (re-)add overlays once the empty
      // style is ready.
      map.on('load', () => {
        if (!map) return;
        applyBasemap(map, DEFAULT_BASEMAP);
        this.syncOverlays();
      });

      // Tap a contour band to read its signal level (vector-only). Querying
      // the live coverage fill layers each click keeps it correct as sites
      // are added/removed; ignored while placing a transmitter.
      map.on('click', (e: maplibregl.MapMouseEvent) => {
        if (!map || this.placingMode || this.measureMode || this.overlayStyle !== 'contours') return;
        const layerIds = this.localSites
          .map((s) => `coverage-${s.id}`)
          .filter((id) => map!.getLayer(id));
        if (layerIds.length === 0) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: layerIds });
        if (hits.length === 0) return;
        const strongest = hits.reduce((a, b) =>
          ((b.properties?.dbm ?? -999) > (a.properties?.dbm ?? -999) ? b : a)
        );
        new maplibregl.Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="mt-popup"><div class="mt-popup-row"><span>Signal</span>` +
            `<span>${strongest.properties?.label ?? ''}</span></div></div>`
          )
          .addTo(map);
      });
      map.on('mousemove', (e: maplibregl.MapMouseEvent) => {
        // Leave the cursor alone while placing (crosshair) or in heatmap mode.
        if (!map || this.placingMode || this.measureMode || this.overlayStyle !== 'contours') return;
        const layerIds = this.localSites
          .map((s) => `coverage-${s.id}`)
          .filter((id) => map!.getLayer(id));
        if (layerIds.length === 0) return;
        const over = map.queryRenderedFeatures(e.point, { layers: layerIds }).length > 0;
        map.getCanvas().style.cursor = over ? 'pointer' : '';
      });

      // The map can construct before the page has its final layout
      // (embedded webviews size the window late), leaving the GL canvas at
      // its pre-layout size. Track the container explicitly and fall back
      // to window resize for environments where ResizeObserver is quiet.
      const container = document.getElementById('map');
      if (container && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => map?.resize()).observe(container);
      }
      window.addEventListener('resize', () => map?.resize());
      map.once('load', () => map?.resize());

      this.setDraftMarker(
        this.splatParams.transmitter.tx_lat,
        this.splatParams.transmitter.tx_lon
      );
      // Site markers survive in-session navigation.
      for (const marker of siteMarkers.values()) marker.addTo(map);
    },
    focusSite(index: number) {
      const site = this.localSites[index];
      if (!site || !map) return;
      const { tx_lat, tx_lon } = site.params.transmitter;
      map.flyTo({ center: [tx_lon, tx_lat], zoom: Math.max(map.getZoom(), 9) });
      const marker = siteMarkers.get(site.id);
      if (marker && !marker.getPopup()?.isOpen()) marker.togglePopup();
    },
    cancelSimulation() {
      abortController?.abort();
    },
    async runSimulation() {
      if (this.simulationState === 'running') {
        return;
      }
      console.log('Simulation running...');
      this.simulationState = 'running';
      this.errorMessage = '';
      this.progress = { phase: 'terrain', completed: 0, total: 1, fraction: 0 };
      abortController = new AbortController();

      try {
        const request = buildCoverageRequest(this.splatParams);
        // Correct meters -> feet conversion for the transmitter height.
        // (The legacy backend passed it through unconverted, so SPLAT!
        // consumed meters as feet; toEngineParams can replicate that with
        // legacyTxHeightAsFeet for comparisons.)
        const params = toEngineParams(request);
        console.log('Coverage request:', request);

        const result = await getEngine().run(params, {
          terrain: getTerrain(),
          signal: abortController.signal,
          onProgress: (p) => {
            this.progress = p;
          },
        });
        console.log(
          `Computed ${result.stats.radials} radials over ${result.stats.pages} pages ` +
            `in ${(result.stats.elapsedMs / 1000).toFixed(1)}s using ${result.stats.workers} workers`
        );

        const cropped = cropToRadius(result, request.lat, request.lon, request.radius);
        const siteParams = cloneObject(this.splatParams);
        const id = crypto.randomUUID();
        const stats = coverageStats(
          cropped,
          request.lat,
          request.lon,
          siteParams.receiver.rx_sensitivity
        );
        const site: Site = { params: siteParams, id, result: cropped, visible: true, stats };
        this.localSites.push(site);

        // The draft pin becomes a persistent, labeled site marker.
        this.cancelPlaceOnMap();
        this.clearDraftMarker();
        if (map) {
          const popup = new maplibregl.Popup({ closeButton: true, offset: 46 })
            .setDOMContent(buildSitePopup(site));
          const marker = new maplibregl.Marker({ element: sitePinElement(), anchor: 'bottom' })
            .setLngLat([request.lon, request.lat])
            .setPopup(popup)
            .addTo(map);
          siteMarkers.set(id, marker);
        }

        this.splatParams.transmitter.name = randanimalSync();
        this.syncOverlays();
        this.simulationState = 'completed';
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.log('Simulation cancelled');
          this.simulationState = 'idle';
        } else {
          console.error('Simulation error:', error);
          this.errorMessage = error instanceof Error ? error.message : String(error);
          this.simulationState = 'failed';
        }
      } finally {
        this.progress = null;
        abortController = undefined;
      }
    }
  }
});

export { useStore }
