<template>
  <div>
    <!-- App header -->
    <nav class="fixed inset-x-0 top-0 z-[1100] flex h-[57px] items-center justify-between border-b border-line bg-sunken px-4">
      <a href="#" class="flex items-center gap-2.5 font-semibold tracking-[0.01em] text-ink no-underline">
        <img src="/logo.svg" alt="Meshtastic logo" width="34" height="18" class="inline-block" />
        <span>Meshtastic <span class="font-normal text-ink-muted">Site Planner</span></span>
      </a>
      <button
        type="button"
        class="mt-btn mt-btn-ghost mt-btn-sm gap-2"
        :aria-pressed="panelOpen"
        aria-label="Toggle site parameters"
        @click="panelOpen = !panelOpen"
      >
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
          <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
          <line x1="4" y1="18" x2="20" y2="18" /><circle cx="7" cy="18" r="2" fill="currentColor" stroke="none" />
        </svg>
        <span class="hidden sm:inline">Parameters</span>
      </button>
    </nav>

    <!-- Map fills the viewport; the drawer overlays its right edge. -->
    <div id="map" ref="map"></div>

    <MapLegend />

    <!-- Dim + dismiss on small screens only (desktop keeps the map usable). -->
    <div v-if="panelOpen" class="fixed inset-0 top-[57px] z-[999] bg-black/40 lg:hidden" @click="panelOpen = false"></div>

    <AppDrawer v-model="panelOpen" title="Site Parameters">
      <Section title="Site / Transmitter" :default-open="true"><Transmitter /></Section>
      <Section title="Receiver"><Receiver /></Section>
      <Section title="Environment"><Environment /></Section>
      <Section title="Simulation Options"><Simulation /></Section>
      <Section title="Display" :default-open="true"><Display /></Section>
      <Section title="Point-to-point link"><PointToPoint /></Section>

      <div v-if="store.localSites.length" class="pt-1">
        <div class="mb-2 text-xs font-bold tracking-[0.08em] text-ink-muted uppercase">Simulated sites</div>
        <ul class="space-y-1.5">
          <li
            v-for="(site, index) in store.localSites"
            :key="site.id"
            class="flex min-h-[44px] items-center gap-1 rounded-lg border border-line bg-surface px-2"
            :class="{ 'opacity-60': !site.visible }"
          >
            <button
              type="button"
              class="grid size-8 shrink-0 place-items-center rounded text-ink-muted hover:text-ink"
              :title="site.visible ? 'Hide coverage' : 'Show coverage'"
              :aria-pressed="site.visible"
              @click="store.toggleSiteVisibility(index)"
            >
              <svg v-if="site.visible" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68"/><path d="M6.6 6.6A13.1 13.1 0 0 0 2 12s3.5 7 10 7a9 9 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/></svg>
            </button>
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 truncate bg-transparent text-left text-sm text-ink hover:text-primary"
              :title="`Go to ${site.params.transmitter.name}`"
              @click="store.focusSite(index)"
            >
              <span class="size-2.5 shrink-0 rounded-full" :style="{ background: siteColor(site) }" aria-hidden="true"></span>
              <span class="truncate">{{ site.params.transmitter.name }}</span>
            </button>
            <button
              type="button"
              class="grid size-8 shrink-0 place-items-center rounded text-ink-muted hover:text-danger"
              :aria-label="`Remove ${site.params.transmitter.name}`"
              @click="store.removeSite(index)"
            >
              <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
            </button>
          </li>
        </ul>
      </div>

      <template #footer>
        <div
          v-if="store.simulationState === 'failed' && store.errorMessage"
          class="mb-2 rounded-lg border border-danger bg-danger-bg p-2 text-sm text-on-danger-bg"
          role="alert"
        >
          {{ store.errorMessage }}
        </div>

        <div v-if="store.progress" class="mb-2" aria-live="polite">
          <div class="h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-200"
              role="progressbar"
              :style="{ width: (store.progress.fraction * 100).toFixed(1) + '%' }"
              :aria-valuenow="Math.round(store.progress.fraction * 100)"
              aria-valuemin="0"
              aria-valuemax="100"
            ></div>
          </div>
          <small class="text-[0.8125rem] text-ink-muted">{{ progressLabel() }}</small>
        </div>

        <div class="flex gap-2">
          <button
            id="runSimulation"
            type="button"
            class="mt-btn mt-btn-primary flex-1"
            :disabled="store.simulationState === 'running'"
            @click="store.runSimulation"
          >
            <span v-if="store.simulationState === 'running'" class="mt-spinner" aria-hidden="true"></span>
            <span>{{ buttonText() }}</span>
          </button>
          <button
            v-if="store.simulationState === 'running'"
            type="button"
            class="mt-btn mt-btn-ghost"
            @click="store.cancelSimulation"
          >
            Cancel
          </button>
        </div>
      </template>
    </AppDrawer>

    <div v-if="store.placingMode" class="mt-place-hint" role="status">
      <span><span class="mt-place-dot"></span>Click the map to place the transmitter</span>
      <button type="button" class="mt-place-cancel" @click="store.cancelPlaceOnMap()">Cancel (Esc)</button>
    </div>

    <div v-if="store.linkState === 'placing'" class="mt-place-hint" role="status">
      <span><span class="mt-place-dot mt-place-dot-target"></span>Click the map to place the link target</span>
      <button type="button" class="mt-place-cancel" @click="store.cancelPlaceTarget()">Cancel (Esc)</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Transmitter from './components/Transmitter.vue';
import Receiver from './components/Receiver.vue';
import Environment from './components/Environment.vue';
import Simulation from './components/Simulation.vue';
import Display from './components/Display.vue';
import PointToPoint from './components/PointToPoint.vue';
import AppDrawer from './components/ui/AppDrawer.vue';
import Section from './components/ui/Section.vue';
import MapLegend from './components/ui/MapLegend.vue';

import { useStore } from './store.ts';
import type { Site } from './types.ts';
import { colormapLut } from './render/colormaps.ts';

const store = useStore();

// Map-first on small screens; the panel opens by default on desktop.
const panelOpen = ref(true);
onMounted(() => {
  if (window.matchMedia('(max-width: 1023px)').matches) panelOpen.value = false;
});

// Each site keeps its own color scale (#17); show a swatch matching its
// overlay so sites are distinguishable in the list.
const siteColor = (site: Site) => {
  const lut = colormapLut(site.params.display.color_scale);
  const i = 192 * 3; // a vivid representative sample of the colormap
  return `rgb(${lut[i]}, ${lut[i + 1]}, ${lut[i + 2]})`;
};

const buttonText = () => {
  if (store.simulationState === 'running') return 'Running';
  if (store.simulationState === 'failed') return 'Failed';
  return 'Run Simulation';
};

const progressLabel = () => {
  const p = store.progress;
  if (!p) return '';
  if (p.phase === 'terrain') return `Downloading terrain (${p.completed}/${p.total} tiles)`;
  if (p.phase === 'compute') return `Computing coverage (${Math.round(p.fraction * 100)}%)`;
  return 'Rendering…';
};
</script>
