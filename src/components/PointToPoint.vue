<template>
  <div>
    <p class="mt-section-hint mb-2">
      Analyze the link from this transmitter to one target: terrain profile,
      line of sight, Fresnel clearance, and link margin.
    </p>

    <div class="d-flex gap-2">
      <button type="button" class="btn btn-sm flex-fill"
        :class="store.linkState === 'placing' ? 'btn-secondary active' : 'btn-primary'"
        @click="store.beginPlaceTarget()">
        {{ store.linkState === 'placing' ? 'Click the map…' : (store.linkTarget ? 'Move target' : 'Pick target on map') }}
      </button>
      <button v-if="store.linkTarget" type="button" class="btn btn-secondary btn-sm" @click="store.clearLink()">
        Clear
      </button>
    </div>

    <div v-if="store.linkTarget" class="row g-2 mt-2">
      <div class="col-6">
        <label for="tgt_lat" class="form-label">Target lat</label>
        <input id="tgt_lat" v-model.number="tLat" @change="applyCoords" type="number" step="0.000001"
          min="-90" max="90" class="form-control form-control-sm" />
      </div>
      <div class="col-6">
        <label for="tgt_lon" class="form-label">Target lon</label>
        <input id="tgt_lon" v-model.number="tLon" @change="applyCoords" type="number" step="0.000001"
          min="-180" max="180" class="form-control form-control-sm" />
      </div>
    </div>

    <p v-if="!store.linkTarget && store.linkState !== 'placing'" class="mt-section-hint mt-2 mb-0">
      Tip: drag the blue target pin to move it; the link recomputes automatically.
    </p>

    <div v-if="store.linkState === 'computing'" class="d-flex align-items-center gap-2 mt-3 small text-secondary">
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      Computing link…
    </div>

    <div v-if="store.linkState === 'error'" class="mt-alert-error mt-3 p-2 small" role="alert">
      {{ store.linkError }}
    </div>

    <div v-if="store.linkAnalysis && store.linkState !== 'computing'" class="mt-3">
      <div class="mt-link-verdict" :class="verdictClass">
        <span class="mt-link-verdict-dot" aria-hidden="true"></span>{{ verdictText }}
      </div>

      <dl class="mt-link-stats mt-2">
        <div><dt>Distance</dt><dd>{{ fmt(store.linkAnalysis.distanceKm, 2) }} km</dd></div>
        <div><dt>Received</dt><dd>{{ fmt(store.linkAnalysis.rxDbm, 1) }} dBm</dd></div>
        <div><dt>Margin</dt><dd :class="store.linkAnalysis.marginDb >= 0 ? 'mt-pos' : 'mt-neg'">{{ store.linkAnalysis.marginDb >= 0 ? '+' : '' }}{{ fmt(store.linkAnalysis.marginDb, 1) }} dB</dd></div>
        <div><dt>Line of sight</dt><dd :class="store.linkAnalysis.losClear ? 'mt-pos' : 'mt-neg'">{{ store.linkAnalysis.losClear ? 'Clear' : 'Blocked' }}</dd></div>
        <div><dt>Fresnel</dt><dd :class="store.linkAnalysis.fresnelClear ? 'mt-pos' : 'mt-neg'">{{ fmt(store.linkAnalysis.fresnelClearanceFraction * 100, 0) }}% clear</dd></div>
      </dl>

      <svg v-if="chart" class="mt-link-chart mt-2" :viewBox="`0 0 ${chart.W} ${chart.H}`" preserveAspectRatio="none"
        role="img" aria-label="Terrain profile with line of sight and Fresnel zone">
        <polygon :points="chart.terrainArea" fill="#3a4150" stroke="none" />
        <polyline :points="chart.terrain" fill="none" stroke="#8a93a6" stroke-width="1" />
        <polyline :points="chart.fresnel" fill="none" :stroke="rayColor" stroke-width="1" stroke-dasharray="3 2" opacity="0.7" />
        <polyline :points="chart.ray" fill="none" :stroke="rayColor" stroke-width="1.5" />
      </svg>
      <div v-if="chart" class="mt-link-axis">
        <span>TX</span>
        <span>{{ fmt(store.linkAnalysis.distanceKm, 1) }} km · {{ fmt(store.linkAzimuthDeg, 0) }}°</span>
        <span>target</span>
      </div>

      <button type="button" class="btn btn-secondary btn-sm w-100 mt-2" @click="store.computeLink()">
        Recompute with current settings
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useStore } from '../store.ts';

const store = useStore();

const tLat = ref<number | null>(null);
const tLon = ref<number | null>(null);
watch(
  () => store.linkTarget,
  (t) => {
    tLat.value = t?.lat ?? null;
    tLon.value = t?.lon ?? null;
  },
  { immediate: true, deep: true }
);

function applyCoords() {
  if (tLat.value == null || tLon.value == null) return;
  const lat = Number(tLat.value);
  const lon = Number(tLon.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
  store.setLinkTarget(lat, lon);
}

const fmt = (n: number, d: number) => (Number.isFinite(n) ? n.toFixed(d) : '–');

const rayColor = computed(() => {
  const a = store.linkAnalysis;
  if (!a) return '#9aa0aa';
  if (a.marginDb >= 0 && a.fresnelClear) return '#67ea94';
  if (a.marginDb >= 0) return '#f5c518';
  return '#ff5c5c';
});

const verdictClass = computed(() => {
  const a = store.linkAnalysis;
  if (!a) return '';
  if (a.marginDb >= 0 && a.losClear && a.fresnelClear) return 'mt-verdict-good';
  if (a.marginDb >= 0 && a.losClear) return 'mt-verdict-marginal';
  return 'mt-verdict-bad';
});

const verdictText = computed(() => {
  const a = store.linkAnalysis;
  if (!a) return '';
  if (a.marginDb < 0) return 'Link unlikely (below sensitivity)';
  if (!a.losClear) return 'Link blocked (no line of sight)';
  if (!a.fresnelClear) return 'Link marginal (Fresnel obstructed)';
  return 'Link looks viable';
});

/* Profile chart geometry: terrain (curvature-adjusted), the line-of-sight ray,
 * and the bottom of the first Fresnel zone, scaled into a fixed viewBox. */
const chart = computed(() => {
  const a = store.linkAnalysis;
  if (!a || a.samples.length < 2) return null;
  const W = 320;
  const H = 120;
  const padX = 3;
  const padY = 6;
  const iw = W - 2 * padX;
  const ih = H - 2 * padY;
  const s = a.samples;
  const xMax = a.distanceKm || 1;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of s) {
    yMin = Math.min(yMin, p.curvedGroundM, p.rayM, p.fresnelBottomM);
    yMax = Math.max(yMax, p.curvedGroundM, p.rayM, p.fresnelBottomM);
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;
  const X = (d: number) => padX + (d / xMax) * iw;
  const Y = (e: number) => padY + (1 - (e - yMin) / (yMax - yMin)) * ih;
  const pts = (sel: (p: (typeof s)[number]) => number) =>
    s.map((p) => `${X(p.distanceKm).toFixed(1)},${Y(sel(p)).toFixed(1)}`).join(' ');
  const terrain = pts((p) => p.curvedGroundM);
  return {
    W,
    H,
    terrain,
    terrainArea: `${padX},${(H - padY).toFixed(1)} ${terrain} ${(W - padX).toFixed(1)},${(H - padY).toFixed(1)}`,
    fresnel: pts((p) => p.fresnelBottomM),
    ray: `${X(s[0].distanceKm)},${Y(s[0].rayM)} ${X(s[s.length - 1].distanceKm)},${Y(s[s.length - 1].rayM)}`,
  };
});
</script>
