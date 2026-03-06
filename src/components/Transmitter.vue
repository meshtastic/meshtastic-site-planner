<template>
    <form novalidate>
        <div class="row g-2 mb-2">
            <div class="col-12">
                <label for="tx_preset" class="form-label">Device Preset</label>
                <select v-model="selectedPreset" @change="applyPreset" class="form-select form-select-sm" id="tx_preset">
                    <option v-for="device in meshtasticDevices" :key="device.id" :value="device">
                        {{ device.name }}
                    </option>
                </select>
            </div>
        </div>

        <div class="row g-2">
            <div class="col-12">
                <label for="name" class="form-label">Site name</label>
                <input v-model="transmitter.name" class="form-control form-control-sm" id="name" required data-bs-toggle="tooltip" title="Site Name" />
            </div>
        </div>
        
        <div class="row g-2 mt-2">
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
            <div class="col-6">
                <label for="tx_power" class="form-label">Power (W)</label>
                <input v-model="transmitter.tx_power" @input="setCustom" type="number" class="form-control form-control-sm" id="tx_power" required min="0" step="0.1" data-bs-toggle="tooltip" title="Transmitter power in watts (>0)." />
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
                <label for="tx_gain" class="form-label">Antenna Gain (dB)</label>
                <input v-model="transmitter.tx_gain" @input="setCustom" type="number" class="form-control form-control-sm" id="tx_gain" required min="0" step="0.1" />
                <div class="invalid-feedback">Gain must be a positive number.</div>
            </div>
        </div>
        <div class="mt-3 d-flex gap-2">
            <button @click="setWithMap" type="button" id="setWithMap" class="btn btn-primary btn-sm" data-bs-toggle="popover" data-bs-trigger="manual" data-bs-placement="left" title="Set Coordinates" data-bs-content="" content="Click on the map to set the transmitter location.">
                Set with Map
            </button>
            <button @click="centerMapOnTransmitter" type="button" class="btn btn-secondary btn-sm">Center map on transmitter</button>
        </div>
    </form>
</template>

<script setup lang="ts">
    import { ref, onMounted } from 'vue';
    import L from 'leaflet';
    import * as bootstrap from 'bootstrap';
    import { useStore } from '../store.ts'
    import { redPinMarker } from '../layers.ts';
    import { meshtasticDevices } from '../devicePresets.ts';

    const store = useStore();
    const transmitter = store.splatParams.transmitter;
    
    // State for the dropdown
    const selectedPreset = ref(meshtasticDevices[0]);

    // Apply the preset values
    const applyPreset = () => {
        if (selectedPreset.value.id !== 'custom') {
            transmitter.tx_power = selectedPreset.value.tx_power!;
            transmitter.tx_gain = selectedPreset.value.tx_gain!;
        }
    };

    // If a user manually changes a pre-filled field, flip dropdown back to "Custom"
    const setCustom = () => {
        selectedPreset.value = meshtasticDevices[0];
    };

    const centerMapOnTransmitter = () => {
        if (!isNaN(transmitter.tx_lat) && !isNaN(transmitter.tx_lon)) {
            store.map!.setView([transmitter.tx_lat, transmitter.tx_lon], store.map!.getZoom()); 
        } else {
            alert("Please enter valid Latitude and Longitude values.");
        }
    };

    let popover = new bootstrap.Popover(document.createElement("input"), {
        trigger: "manual",
    });

    const setWithMap = () => {
        popover.show();
        store.map!.once("click", function (e: any) {
            let { lat, lng } = e.latlng;
            lng = ((((lng + 180) % 360) + 360) % 360) - 180;

            store.setTxCoords(lat.toFixed(6), lng.toFixed(6));

            if (store.currentMarker) {
                store.map!.removeLayer(store.currentMarker as L.Marker);
            }
            store.currentMarker = L.marker([lat, lng], { icon: redPinMarker }).addTo(store.map as L.Map)
            popover.hide();
        });
    };

    onMounted(() => {
        popover = new bootstrap.Popover(document.getElementById("setWithMap") as Element, {
            trigger: "manual",
        });
        store.initMap();
    });
</script>