import { defineStore } from 'pinia';
// import { useLocalStorage } from '@vueuse/core';
import { randanimalSync } from 'randanimal';
import maplibregl from 'maplibre-gl';
import { type Site, type SplatParams } from './types.ts';
import { cloneObject } from './utils.ts';
import { draftPinElement, sitePinElement } from './layers.ts';
import { BASEMAPS, DEFAULT_BASEMAP, applyBasemap, emptyStyle } from './map/styles.ts';
import { BasemapControl, ExportControl } from './map/controls.ts';
import { SearchControl } from './map/search.ts';
import { coverageImage, cropToRadius } from './map/overlay.ts';
import { coverageContours } from './map/contours.ts';
import { WasmCoverageEngine } from './engine/WasmCoverageEngine.ts';
import type { CoverageProgress } from './engine/CoverageEngine.ts';
import { toEngineParams, type CoverageRequest } from './engine/params.ts';
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

function getEngine(): WasmCoverageEngine {
  engine ??= new WasmCoverageEngine();
  return engine;
}

function getTerrain(): TerrainService {
  terrain ??= new TerrainService();
  return terrain;
}

function sitePopupHtml(p: SplatParams): string {
  const t = p.transmitter;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  return `
    <div class="mt-popup">
      <div class="mt-popup-title">${esc(t.name)}</div>
      <div class="mt-popup-row"><span>Frequency</span><span>${t.tx_freq} MHz</span></div>
      <div class="mt-popup-row"><span>Power</span><span>${t.tx_power} W</span></div>
      <div class="mt-popup-row"><span>Antenna height</span><span>${t.tx_height} m</span></div>
      <div class="mt-popup-row"><span>Max range</span><span>${p.simulation.simulation_extent} km</span></div>
    </div>`;
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
      splatParams: <SplatParams>{
        transmitter: {
          name: randanimalSync(),
          tx_lat: 51.102167,
          tx_lon: -114.098667,
          tx_power: 0.1,
          tx_freq: 907.0,
          tx_height: 2.0,
          tx_gain: 2.0
        },
        receiver: {
          rx_sensitivity: -130.0,
          rx_height: 1.0,
          rx_gain: 2.0,
          rx_loss: 2.0
        },
        environment: {
          radio_climate: 'continental_temperate',
          polarization: 'vertical',
          clutter_height: 1.0,
          ground_dielectric: 15.0,
          ground_conductivity: 0.005,
          atmosphere_bending: 301.0
        },
        simulation: {
          situation_fraction: 95.0,
          time_fraction: 95.0,
          simulation_extent: 30.0,
          high_resolution: false
        },
        display: {
          color_scale: 'plasma',
          min_dbm: -130.0,
          max_dbm: -80.0,
          overlay_transparency: 50
        },
      }
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
    removeSite(index: number) {
      const [removed] = this.localSites.splice(index, 1)
      if (removed) {
        siteMarkers.get(removed.id)?.remove();
        siteMarkers.delete(removed.id);
        if (map) this.removeOverlay(removed.id);
      }
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
        attributionControl: { compact: false },
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
      map.addControl(
        new BasemapControl(Object.keys(BASEMAPS), DEFAULT_BASEMAP, (name) => {
          // Swap the basemap raster source/layers in place (keeps overlays,
          // markers, and the GL context intact).
          if (map) applyBasemap(map, name);
        }),
        'bottom-left'
      );

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
        if (!map || this.placingMode || this.overlayStyle !== 'contours') return;
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
        if (!map || this.placingMode || this.overlayStyle !== 'contours') return;
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
        this.localSites.push({ params: siteParams, id, result: cropped });

        // The draft pin becomes a persistent, labeled site marker.
        this.cancelPlaceOnMap();
        this.clearDraftMarker();
        if (map) {
          const popup = new maplibregl.Popup({ closeButton: false, offset: 46 })
            .setHTML(sitePopupHtml(siteParams));
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
