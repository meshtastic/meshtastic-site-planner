<template>
    <form novalidate>
        <div class="row g-2 mb-2">
            <div class="col-12">
                <label for="rx_preset" class="form-label">Device Preset</label>
                <select v-model="selectedPreset" @change="applyPreset" class="form-select form-select-sm" id="rx_preset">
                    <option v-for="device in meshtasticDevices" :key="device.id" :value="device">
                        {{ device.name }}
                    </option>
                </select>
            </div>
        </div>

        <div class="row g-2">
            <div class="col-6">
                <label for="rx_sensitivity" class="form-label">Sensitivity (dBm)</label>
                <input v-model="receiver.rx_sensitivity" @input="setCustom" type="number" class="form-control form-control-sm" id="rx_sensitivity" required step="1" min="-150" max="-30" />
            <div class="invalid-feedback">Please enter a valid sensitivity.</div>
            </div>
                <div class="col-6">
                <label for="rx_height" class="form-label">Height AGL (m)</label>
                <input v-model="receiver.rx_height" type="number" class="form-control form-control-sm" id="rx_height" required min="0" step="0.1" />
                <div class="invalid-feedback">Height must be a positive number.</div>
                </div>
            </div>
            <div class="row g-2 mt-2">
                <div class="col-6">
                <label for="rx_gain" class="form-label">Antenna Gain (dB)</label>
                <input v-model="receiver.rx_gain" @input="setCustom" type="number" class="form-control form-control-sm" id="rx_gain" required min="0" max="30" step="0.1" />
                <div class="invalid-feedback">Gain must be a positive number.</div>
            </div>
            <div class="col-6">
                <label for="rx_loss" class="form-label">Cable Loss (dB)</label>
                <input v-model="receiver.rx_loss" type="number" class="form-control form-control-sm" id="rx_loss" required min="0" max="100" step="0.1" />
                <div class="invalid-feedback">Loss must be a positive number.</div>
            </div>
        </div>
    </form>
</template>

<script setup lang="ts">
    import { ref } from 'vue';
    import { useStore } from '../store.ts';
    import { meshtasticDevices } from '../devicePresets.ts';

    const store = useStore();
    const receiver = store.splatParams.receiver;

    // State for the dropdown
    const selectedPreset = ref(meshtasticDevices[0]);

    // Apply the preset values
    const applyPreset = () => {
        if (selectedPreset.value.id !== 'custom') {
            receiver.rx_sensitivity = selectedPreset.value.rx_sensitivity!;
            receiver.rx_gain = selectedPreset.value.rx_gain!;
        }
    };

    // If a user manually changes a pre-filled field, flip dropdown back to "Custom"
    const setCustom = () => {
        selectedPreset.value = meshtasticDevices[0];
    };
</script>