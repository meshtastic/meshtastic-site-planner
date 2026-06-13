/* Branded map markers (MapLibre takes plain DOM elements).
 * The basemap catalog lives in src/map/styles.ts. */

/* Meshtastic-branded site pin: green teardrop with the dark brand mark, inline
 * SVG so it stays crisp at any zoom/DPI. The marker is anchored at 'bottom', so
 * the teardrop tip sits on the coordinate at every zoom level.
 *
 * The monogram is the official logo (public/logo.svg) embedded verbatim — its
 * transforms/coordinates and the 2.72 2.55 94.57 49.89 viewBox are copied as-is
 * so it matches the brand exactly (a short left stroke + the larger peak),
 * recolored dark for contrast. A nested <svg> maps that viewBox into a 24-wide
 * box centered in the teardrop head; keep the two in sync if logo.svg changes. */
const PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
  <path d="M17 1C8.16 1 1 8.16 1 17c0 11.5 13.2 24.06 15.06 25.78a1.4 1.4 0 0 0 1.88 0C19.8 41.06 33 28.5 33 17 33 8.16 25.84 1 17 1Z"
        fill="#67ea94" stroke="#0f1017" stroke-width="1.5"/>
  <svg x="5" y="9.67" width="24" height="12.66" viewBox="2.72 2.55 94.57 49.89" preserveAspectRatio="xMidYMid meet">
    <g fill="#0f1017" transform="matrix(0.802386,0,0,0.460028,-421.748,-122.127)">
      <g transform="matrix(0.579082,0,0,1.01004,460.975,-39.6867)">
        <path d="M250.908,330.267L193.126,415.005L180.938,406.694L244.802,313.037C246.174,311.024 248.453,309.819 250.889,309.816C253.326,309.814 255.606,311.015 256.982,313.026L320.994,406.536L308.821,414.869L250.908,330.267Z"/>
      </g>
      <g transform="matrix(0.582378,0,0,1.01579,485.019,-211.182)">
        <path d="M87.642,581.398L154.757,482.977L142.638,474.713L75.523,573.134L87.642,581.398Z"/>
      </g>
    </g>
  </svg>
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

/* Point-to-point target (receiver) pin: a blue teardrop with a hollow dot, so
 * it reads as the "other end" of a link, distinct from the green TX pin (#14). */
const TARGET_PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 34 44">
  <path d="M17 1C8.16 1 1 8.16 1 17c0 11.5 13.2 24.06 15.06 25.78a1.4 1.4 0 0 0 1.88 0C19.8 41.06 33 28.5 33 17 33 8.16 25.84 1 17 1Z"
        fill="#3aa0ff" stroke="#0f1017" stroke-width="1.5"/>
  <circle cx="17" cy="17" r="6" fill="none" stroke="#0f1017" stroke-width="3"/>
</svg>`;

/** Draggable point-to-point target marker. */
export function targetPinElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mt-pin mt-pin-target';
  el.innerHTML = TARGET_PIN_SVG;
  return el;
}
