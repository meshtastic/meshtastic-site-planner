<template>
  <div>
    <p class="mt-hint mb-3">The nodes that should hear this site (-130 dBm matches the default LongFast preset).</p>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <label for="rx_sensitivity" class="mt-label">Sensitivity (dBm)</label>
        <input v-model="receiver.rx_sensitivity" type="number" class="mt-input" id="rx_sensitivity" step="1" min="-150" max="-30" />
      </div>
      <div>
        <label for="rx_height" class="mt-label">Height AGL (m)</label>
        <input v-model="receiver.rx_height" type="number" class="mt-input" id="rx_height" min="0" step="0.1" />
      </div>
      <div>
        <label for="rx_gain" class="mt-label">Antenna Gain (dBi)</label>
        <input v-model="receiver.rx_gain" type="number" class="mt-input" id="rx_gain" min="0" max="30" step="0.1" />
      </div>
      <div>
        <label for="rx_loss" class="mt-label">Cable Loss (dB)</label>
        <input v-model="receiver.rx_loss" type="number" class="mt-input" id="rx_loss" min="0" max="100" step="0.1" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from '../store.ts';
const receiver = useStore().splatParams.receiver;
</script>
