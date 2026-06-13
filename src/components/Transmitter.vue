
<template>
    <form novalidate>
        <p class="mt-section-hint mb-2">The radio whose coverage is simulated.</p>
        <div class="row g-2">
            <div class="col-12">
                <label for="name" class="form-label">Site name</label>
                <input v-model="transmitter.name" class="form-control form-control-sm" id="name" required data-bs-toggle="tooltip" title="Site Name" />
            </div>
        </div>
        <div class="row g-2">
            <div class="col-6">
                <label for="tx_lat" class="form-label">Latitude (degrees)</label>
                <input v-model="transmitter.tx_lat" type="number" class="form-control form-control-sm" id="tx_lat" required min="-90" max="90" step="0.000001" data-bs-toggle="tooltip" title="Transmitter latitude in degrees (-90 to 90)." />
                <div class="invalid-feedback">Please enter a valid latitude (-90 to 90).</div>
            </div>
            <div class="col-6">
                <label for="tx_lon" class="form-label">Longitude (degrees)</label>
                <input v-model="transmitter.tx_lon" type="number" class="form-control form-control-sm" id="tx_lon" required min="-180" max="180" step="0.000001" data-bs-toggle="tooltip" title="Transmitter longitude in degrees (-180 to 180)." />
                <div class="invalid-feedback">Please enter a valid longitude (-180 to 180).</div>
            </div>
        </div>
        <div class="row g-2 mt-2">
            <div class="col-12">
                <label for="device" class="form-label">Device (optional)</label>
                <select v-model="selectedDevice" @change="applyDevice" class="form-select form-select-sm" id="device" data-bs-toggle="tooltip" title="Prefill power and stock-antenna gain from a common Meshtastic device.">
                    <option value="">Custom / manual</option>
                    <option v-for="(d, i) in DEVICE_PROFILES" :key="i" :value="i">{{ d.label }}</option>
                </select>
                <p class="mt-section-hint mt-1 mb-0">Fills typical power &amp; stock-antenna gain. Tune for your antenna and region.</p>
            </div>
        </div>
        <div class="row g-2 mt-2">
            <div class="col-6">
                <label for="tx_power" class="form-label">Power (W)</label>
                <input v-model="transmitter.tx_power" type="number" class="form-control form-control-sm" id="tx_power" required min="0" step="0.1" data-bs-toggle="tooltip" title="Transmitter power in watts (>0)." />
                <div class="invalid-feedback">Power must be a positive number.</div>
            </div>
            <div class="col-6">
                <label for="frequency" class="form-label">Frequency (MHz)</label>
                <input v-model="transmitter.tx_freq" type="number" class="form-control form-control-sm" id="tx_freq" required min="20" max="20000" step="0.1" data-bs-toggle="tooltip" title="Transmitter frequency in MHz (20 to 20,000)." />
                <div class="invalid-feedback">Frequency must be a positive number.</div>
            </div>
        </div>
        <div class="row g-2 mt-2">
            <div class="col-6">
                <label for="tx_height" class="form-label">Height AGL (m)</label>
                <input v-model="transmitter.tx_height" type="number" class="form-control form-control-sm" id="tx_height" required min="1.0" step="0.1" data-bs-toggle="tooltip" title="Transmitter height above ground in meters (>= 1.0)." />
                <div class="invalid-feedback">Height must be a positive number.</div>
            </div>
            <div class="col-6">
                <label for="tx_gain" class="form-label">Antenna Gain (dBi)</label>
                <input v-model="transmitter.tx_gain" type="number" class="form-control form-control-sm" id="tx_gain" required min="0" step="0.1" />
                <div class="invalid-feedback">Gain must be a positive number.</div>
            </div>
        </div>
        <div class="mt-3 d-flex gap-2">
            <button @click="store.beginPlaceOnMap()" type="button" id="setWithMap"
                class="btn btn-sm text-nowrap flex-fill"
                :class="store.placingMode ? 'btn-secondary active' : 'btn-primary'">
                {{ store.placingMode ? 'Click the map…' : 'Place on map' }}
            </button>
            <button @click="centerMapOnTransmitter" type="button" class="btn btn-secondary btn-sm text-nowrap flex-fill">Center on site</button>
        </div>
        <p class="mt-section-hint mt-2 mb-0">Tip: drag the green pin to fine-tune, or type coordinates above.</p>
    </form>
</template>

<script setup lang="ts">
    import { useStore } from '../store.ts'
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
            alert("Please enter valid Latitude and Longitude values.");
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
