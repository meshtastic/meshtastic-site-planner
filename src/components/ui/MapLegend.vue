<!-- On-map coverage legend (#2): a persistent key for the heatmap/contour
     colours so the scale is readable without opening the Display panel. Driven
     by the most-recently-added visible site (each site keeps its own scale). -->
<template>
  <div
    v-if="active"
    class="fixed bottom-3 left-14 z-[500] rounded-xl border border-line bg-canvas/90 px-3 py-2 shadow-2xl backdrop-blur-sm"
  >
    <div class="mb-1 flex items-center justify-between gap-3">
      <span class="text-[0.6875rem] font-bold tracking-wider text-ink-muted uppercase">Signal</span>
      <span class="text-[0.6875rem] font-semibold text-ink-muted">{{ styleLabel }}</span>
    </div>
    <img :src="colorbarSrc" alt="" class="mt-colorbar !h-3 w-40" />
    <div class="mt-1 flex justify-between text-[0.6875rem] font-semibold text-ink-muted tabular-nums">
      <span>{{ active.min_dbm }} dBm</span>
      <span>{{ active.max_dbm }} dBm</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from '../../store.ts';

const store = useStore();

const active = computed(() => {
  const visible = store.localSites.filter((s) => s.visible !== false && s.result);
  return visible.length ? visible[visible.length - 1].params.display : null;
});

const colorbarSrc = computed(() => `${import.meta.env.BASE_URL}colormaps/${active.value?.color_scale}.png`);
const styleLabel = computed(() => (store.overlayStyle === 'contours' ? 'Contours' : 'Heatmap'));
</script>
