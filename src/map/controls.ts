/* Small custom MapLibre controls: basemap switcher, PNG export, ruler. */

import type { IControl, Map as MlMap } from 'maplibre-gl';

/** Toggle button for the measure/ruler tool (#15). State lives in the store;
 * setActive() keeps the button highlight in sync (e.g. when Esc exits). */
export class MeasureControl implements IControl {
  private container?: HTMLElement;
  private button?: HTMLButtonElement;

  constructor(private readonly onToggle: () => void) {}

  onAdd(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Measure distance';
    button.setAttribute('aria-label', 'Measure distance');
    button.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19 19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/></svg>';
    button.onclick = () => this.onToggle();
    div.appendChild(button);
    this.button = button;
    this.container = div;
    return div;
  }

  setActive(active: boolean): void {
    this.button?.classList.toggle('mt-ctrl-active', active);
  }

  onRemove(): void {
    this.container?.remove();
  }
}

/** Radio-style basemap switcher (replaces Leaflet's layers control). */
export class BasemapControl implements IControl {
  private container?: HTMLElement;

  constructor(
    private readonly names: string[],
    private current: string,
    private readonly onSwitch: (name: string) => void
  ) {}

  onAdd(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'maplibregl-ctrl maplibregl-ctrl-group mt-basemap-ctrl';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mt-basemap-toggle';
    button.title = 'Change basemap';
    button.setAttribute('aria-label', 'Change basemap');
    button.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="m2 12 10 5 10-5"/><path d="m2 16 10 5 10-5"/></svg>';

    const list = document.createElement('div');
    list.className = 'mt-basemap-list';
    list.hidden = true;

    for (const name of this.names) {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = name;
      item.className = 'mt-basemap-item' + (name === this.current ? ' active' : '');
      item.onclick = () => {
        this.current = name;
        list.querySelectorAll('.mt-basemap-item').forEach((el) =>
          el.classList.toggle('active', el === item)
        );
        list.hidden = true;
        this.onSwitch(name);
      };
      list.appendChild(item);
    }

    button.onclick = () => {
      list.hidden = !list.hidden;
    };

    div.appendChild(button);
    div.appendChild(list);
    this.container = div;
    return div;
  }

  onRemove(): void {
    this.container?.remove();
  }
}

/** Downloads the current map canvas as a PNG (replaces leaflet-easyprint).
 * Requires the map to be created with preserveDrawingBuffer: true. */
export class ExportControl implements IControl {
  private container?: HTMLElement;
  private map?: MlMap;

  onAdd(map: MlMap): HTMLElement {
    this.map = map;
    const div = document.createElement('div');
    div.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Save map as image';
    button.setAttribute('aria-label', 'Save map as image');
    button.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>';
    button.onclick = () => {
      const m = this.map;
      if (!m) return;
      m.once('render', () => {
        const link = document.createElement('a');
        link.download = 'sites.png';
        link.href = m.getCanvas().toDataURL('image/png');
        link.click();
      });
      m.triggerRepaint();
    };
    div.appendChild(button);
    this.container = div;
    return div;
  }

  onRemove(): void {
    this.container?.remove();
    this.map = undefined;
  }
}
