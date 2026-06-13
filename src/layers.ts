/* Branded map markers (MapLibre takes plain DOM elements).
 * The basemap catalog lives in src/map/styles.ts. */

/* Meshtastic-branded site pin: green teardrop, dark M monogram (the brand
 * mark), inline SVG so it stays crisp at any zoom/DPI. The marker is
 * anchored at 'bottom', so the teardrop tip sits on the coordinate at
 * every zoom level. */
const PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
  <path d="M17 1C8.16 1 1 8.16 1 17c0 11.5 13.2 24.06 15.06 25.78a1.4 1.4 0 0 0 1.88 0C19.8 41.06 33 28.5 33 17 33 8.16 25.84 1 17 1Z"
        fill="#67ea94" stroke="#0f1017" stroke-width="1.5"/>
  <path d="m17 14.6-6.04 8.86-2.55-1.74 7.43-10.9a1.4 1.4 0 0 1 2.32 0l7.45 10.88-2.54 1.74L17 14.6Zm-9.33 8.85 5.45-7.99-2.55-1.74-5.44 7.99 2.54 1.74Z"
        fill="#0f1017"/>
</svg>`;

/** Marker element for a simulated site. */
export function sitePinElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mt-pin';
  el.innerHTML = PIN_SVG;
  return el;
}

/** Draft transmitter position (before a run): same pin, pulsing halo. */
export function draftPinElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mt-pin mt-pin-draft';
  el.innerHTML = `<span class="mt-pin-pulse" aria-hidden="true"></span>${PIN_SVG}`;
  return el;
}
