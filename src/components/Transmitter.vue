<template>
  <div>
    <p class="mt-hint mb-3">The radio whose coverage is simulated.</p>
    <div class="grid grid-cols-2 gap-2">
      <div class="col-span-2">
        <label for="name" class="mt-label">Site name</label>
        <input v-model="transmitter.name" class="mt-input" id="name" title="Site name" />
      </div>
      <div>
        <label for="tx_lat" class="mt-label">Latitude (degrees)</label>
        <input v-model="transmitter.tx_lat" type="number" class="mt-input" id="tx_lat" min="-90" max="90" step="0.000001" title="Transmitter latitude in degrees (-90 to 90)." />
      </div>
      <div>
        <label for="tx_lon" class="mt-label">Longitude (degrees)</label>
        <input v-model="transmitter.tx_lon" type="number" class="mt-input" id="tx_lon" min="-180" max="180" step="0.000001" title="Transmitter longitude in degrees (-180 to 180)." />
      </div>
      <div class="col-span-2">
        <label for="device" class="mt-label">Device (optional)</label>
        <select v-model="selectedDevice" @change="applyDevice" class="mt-select" id="device" title="Prefill power and stock-antenna gain from a common Meshtastic device.">
          <option value="">Custom / manual</option>
          <option v-for="(d, i) in DEVICE_PROFILES" :key="i" :value="i">{{ d.label }}</option>
        </select>
        <p class="mt-hint mt-1">Fills typical power &amp; stock-antenna gain. Tune for your antenna and region.</p>
      </div>
      <div>
        <label for="tx_power" class="mt-label">Power (W)</label>
        <input v-model="transmitter.tx_power" type="number" class="mt-input" id="tx_power" min="0" step="0.1" title="Transmitter power in watts (>0)." />
      </div>
      <div>
        <label for="tx_freq" class="mt-label">Frequency (MHz)</label>
        <input v-model="transmitter.tx_freq" type="number" class="mt-input" id="tx_freq" min="20" max="20000" step="0.1" title="Transmitter frequency in MHz (20 to 20,000)." />
      </div>
      <div>
        <label for="tx_height" class="mt-label">Height AGL (m)</label>
        <input v-model="transmitter.tx_height" type="number" class="mt-input" id="tx_height" min="1.0" step="0.1" title="Transmitter height above ground in meters (>= 1.0)." />
      </div>
      <div>
        <label for="tx_gain" class="mt-label">Antenna Gain (dBi)</label>
        <input v-model="transmitter.tx_gain" type="number" class="mt-input" id="tx_gain" min="0" step="0.1" />
      </div>
    </div>
    <div class="mt-3 flex gap-2">
      <button
        @click="store.beginPlaceOnMap()"
        type="button"
        id="setWithMap"
        class="mt-btn mt-btn-sm flex-1 whitespace-nowrap"
        :class="store.placingMode ? 'mt-btn-secondary' : 'mt-btn-primary'"
      >
        {{ store.placingMode ? 'Click the map…' : 'Place on map' }}
      </button>
      <button @click="centerMapOnTransmitter" type="button" class="mt-btn mt-btn-secondary mt-btn-sm flex-1 whitespace-nowrap">
        Center on site
      </button>
    </div>
    <p class="mt-hint mt-2">Tip: drag the green pin to fine-tune, or type coordinates above.</p>
  </div>
</template>

<script setup lang="ts">
import { useStore } from '../store.ts';
import { onMounted, watch, ref } from 'vue';
import { DEVICE_PROFILES } from '../deviceProfiles';
const store = useStore();
const transmitter = store.splatParams.transmitter;

// Optional device quick-fill (#51): selecting a radio prefills power + gain.
const selectedDevice = ref<number | ''>('');
function applyDevice() {
  if (selectedDevice.value === '') return;
  const d = DEVICE_PROFILES[selectedDevice.value as number];
  if (!d) return;
  transmitter.tx_power = d.tx_power;
  transmitter.tx_gain = d.tx_gain;
}

// If power or gain is hand-edited away from the chosen device, fall back to
// "Custom" so the dropdown never misrepresents the current values.
watch(
  () => [Number(transmitter.tx_power), Number(transmitter.tx_gain)] as const,
  ([p, g]) => {
    if (selectedDevice.value === '') return;
    const d = DEVICE_PROFILES[selectedDevice.value as number];
    if (d && (p !== d.tx_power || g !== d.tx_gain)) selectedDevice.value = '';
  }
);

const centerMapOnTransmitter = () => {
  if (!isNaN(transmitter.tx_lat) && !isNaN(transmitter.tx_lon)) {
    store.getMap()?.flyTo({ center: [transmitter.tx_lon, transmitter.tx_lat] });
  } else {
    alert('Please enter valid Latitude and Longitude values.');
  }
};

// Typing coordinates moves (or creates) the draggable draft pin, so the
// text fields and the map marker always agree. Skipped mid-simulation.
watch(
  () => [Number(transmitter.tx_lat), Number(transmitter.tx_lon)] as const,
  ([lat, lon]) => {
    if (store.simulationState === 'running') return;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
    store.setDraftMarker(lat, lon);
  }
);

onMounted(() => {
  store.initMap(); // Initialize the map
});
</script>
