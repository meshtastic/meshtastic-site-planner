<template>
  <div>
    <label class="mt-label">Overlay style</label>
    <div class="mb-3 flex w-full overflow-hidden rounded-lg border border-line" role="group" aria-label="Overlay style">
      <button
        type="button"
        class="flex-1 py-2 text-sm font-semibold transition"
        :class="store.overlayStyle === 'heatmap' ? 'bg-primary text-on-primary' : 'bg-surface-2 text-ink hover:bg-surface-3'"
        @click="store.setOverlayStyle('heatmap')"
      >
        Heatmap
      </button>
      <button
        type="button"
        class="flex-1 border-l border-line py-2 text-sm font-semibold transition"
        :class="store.overlayStyle === 'contours' ? 'bg-primary text-on-primary' : 'bg-surface-2 text-ink hover:bg-surface-3'"
        @click="store.setOverlayStyle('contours')"
      >
        Contours
      </button>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <div>
        <label for="min_dbm" class="mt-label">Minimum dBm</label>
        <input v-model="display.min_dbm" type="number" class="mt-input" id="min_dbm" step="0.1" />
      </div>
      <div>
        <label for="max_dbm" class="mt-label">Maximum dBm</label>
        <input v-model="display.max_dbm" type="number" class="mt-input" id="max_dbm" step="0.1" />
      </div>
      <div>
        <label for="color_scale" class="mt-label">Color Scale</label>
        <select v-model="display.color_scale" id="color_scale" class="mt-select">
          <option value="plasma">Plasma</option>
          <option value="viridis">Viridis (colorblind-safe)</option>
          <option value="CMRmap">CMR map</option>
          <option value="cool">Cool</option>
          <option value="turbo">Turbo</option>
          <option value="jet">Jet</option>
        </select>
      </div>
      <div>
        <label for="overlay_transparency" class="mt-label">Transparency (%)</label>
        <input v-model="display.overlay_transparency" type="number" class="mt-input" id="overlay_transparency" min="0" max="100" step="1" />
      </div>
    </div>

    <p class="mt-hint mt-3 mb-1">Changes apply instantly to existing coverage.</p>
    <div class="mt-1">
      <img :src="colorbarSrc" alt="Color scale preview" class="mt-colorbar" />
      <div class="mt-1 flex justify-between">
        <span class="mt-legend-label">{{ display.min_dbm }} dBm</span>
        <span class="mt-legend-label">{{ display.max_dbm }} dBm</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { useStore } from '../store.ts';
const store = useStore();
const display = store.splatParams.display;
const colorbarSrc = computed(() => `${import.meta.env.BASE_URL}colormaps/${display.color_scale}.png`);

// #1 live recolor: re-render existing coverage as the controls change (no
// recompute). Debounced so dragging through values / typing stays smooth.
watchDebounced(
  () => [display.color_scale, display.min_dbm, display.max_dbm, display.overlay_transparency],
  () => store.applyDisplayLive(),
  { debounce: 200 }
);
</script>
