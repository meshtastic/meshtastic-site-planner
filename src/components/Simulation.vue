<template>
  <div>
    <p class="mt-hint mb-3">Statistical confidence and the maximum range to compute. Longer ranges take longer.</p>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <label for="situation_fraction" class="mt-label">Situation Fraction (%)</label>
        <input v-model="simulation.situation_fraction" type="number" class="mt-input" id="situation_fraction" min="1" max="100" step="0.1" />
      </div>
      <div>
        <label for="time_fraction" class="mt-label">Time Fraction (%)</label>
        <input v-model="simulation.time_fraction" type="number" class="mt-input" id="time_fraction" min="1" max="100" step="0.1" />
      </div>
      <div class="col-span-2">
        <label for="simulation_extent" class="mt-label">Max Range (km)</label>
        <input v-model="simulation.simulation_extent" type="number" class="mt-input" id="simulation_extent" min="1" :max="simulation.high_resolution ? 70 : 150" step="1" />
      </div>
    </div>

    <label class="mt-3 flex cursor-pointer items-center gap-3">
      <span class="relative inline-flex shrink-0">
        <input v-model="simulation.high_resolution" type="checkbox" class="peer sr-only" id="high_resolution" />
        <span class="block h-5 w-9 rounded-full bg-surface-3 transition-colors peer-checked:bg-primary"></span>
        <span class="absolute top-0.5 left-0.5 size-4 rounded-full bg-ink transition-transform peer-checked:translate-x-4"></span>
      </span>
      <span class="text-sm font-medium text-ink">High resolution terrain (30 m)</span>
    </label>
    <p class="mt-hint mt-1">9x more detail than the default 90 m grid. Slower and limited to a 70 km range.</p>
  </div>
</template>

<script setup lang="ts">
import { useStore } from '../store.ts';
const simulation = useStore().splatParams.simulation;
</script>
