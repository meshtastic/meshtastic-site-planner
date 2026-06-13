/* Place search (geocoder) control for MapLibre.
 *
 * Lets the user jump the map to a place by name — the single most useful
 * control for "plan coverage around <my town>". Navigation only: it never
 * moves the transmitter (drag the pin or use "Place on map" for that).
 *
 * Backed by OpenStreetMap Nominatim. To respect its usage policy we search
 * on submit (Enter), not per keystroke, and request at most 5 results.
 * A production deployment with real traffic should swap in a keyed
 * geocoder (MapTiler, Mapbox, self-hosted Nominatim) — only `search()`
 * below would change.
 */

import type { IControl, Map as MlMap } from 'maplibre-gl';

interface Place {
  label: string;
  lon: number;
  lat: number;
  bbox?: [number, number, number, number]; // [w, s, e, n]
}

async function searchNominatim(query: string, signal: AbortSignal): Promise<Place[]> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' +
    encodeURIComponent(query);
  const resp = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`geocoder HTTP ${resp.status}`);
  const rows = (await resp.json()) as Array<{
    display_name: string;
    lon: string;
    lat: string;
    boundingbox?: [string, string, string, string]; // [s, n, w, e]
  }>;
  return rows.map((r) => ({
    label: r.display_name,
    lon: Number(r.lon),
    lat: Number(r.lat),
    bbox: r.boundingbox
      ? [Number(r.boundingbox[2]), Number(r.boundingbox[0]), Number(r.boundingbox[3]), Number(r.boundingbox[1])]
      : undefined,
  }));
}

export class SearchControl implements IControl {
  private container?: HTMLElement;
  private map?: MlMap;
  private inFlight?: AbortController;

  onAdd(map: MlMap): HTMLElement {
    this.map = map;
    const div = document.createElement('div');
    div.className = 'maplibregl-ctrl mt-search';

    const form = document.createElement('form');
    form.className = 'mt-search-form';

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search for a place…';
    input.className = 'mt-search-input';
    input.setAttribute('aria-label', 'Search for a place');

    const results = document.createElement('div');
    results.className = 'mt-search-results';
    results.hidden = true;

    const clearResults = () => {
      results.innerHTML = '';
      results.hidden = true;
    };

    const renderResults = (places: Place[]) => {
      results.innerHTML = '';
      if (places.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'mt-search-empty';
        empty.textContent = 'No matches';
        results.appendChild(empty);
      } else {
        for (const p of places) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'mt-search-item';
          item.textContent = p.label;
          item.title = p.label;
          item.onclick = () => {
            if (p.bbox) {
              this.map?.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { maxZoom: 13, padding: 40 });
            } else {
              this.map?.flyTo({ center: [p.lon, p.lat], zoom: 11 });
            }
            input.value = p.label;
            clearResults();
          };
          results.appendChild(item);
        }
      }
      results.hidden = false;
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      this.inFlight?.abort();
      this.inFlight = new AbortController();
      results.innerHTML = '<div class="mt-search-empty">Searching…</div>';
      results.hidden = false;
      try {
        renderResults(await searchNominatim(q, this.inFlight.signal));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        results.innerHTML = '<div class="mt-search-empty">Search failed</div>';
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        clearResults();
      }
    });
    // Don't let map keyboard shortcuts (zoom, pan) eat typing.
    input.addEventListener('keydown', (e) => e.stopPropagation());

    form.appendChild(input);
    div.appendChild(form);
    div.appendChild(results);
    this.container = div;
    return div;
  }

  onRemove(): void {
    this.inFlight?.abort();
    this.container?.remove();
    this.map = undefined;
  }
}
