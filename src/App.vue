<template>
  <div>
    <nav class="navbar mt-navbar fixed-top">
      <div class="container-fluid">
        <a class="navbar-brand" href="#">
          <img src="/logo.svg" alt="Meshtastic logo" width="34" height="18" class="d-inline">
          <span>Meshtastic <span class="fw-normal">Site Planner</span></span>
        </a>
        <button class="navbar-toggler" type="button" data-bs-toggle="offcanvas" data-bs-target="#paramsPanel" aria-controls="paramsPanel" aria-label="Toggle site parameters">
          <span class="navbar-toggler-icon"></span>
        </button>
      </div>
    </nav>

    <div class="offcanvas offcanvas-end mt-sidebar show" tabindex="-1" id="paramsPanel" aria-labelledby="paramsPanelLabel" data-bs-backdrop="false" data-bs-scroll="true">
      <div class="offcanvas-header">
        <h5 class="offcanvas-title" id="paramsPanelLabel">Site Parameters</h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body d-flex flex-column">
        <div class="accordion mt-accordion accordion-flush flex-grow-0" id="paramsAccordion">
          <div class="accordion-item">
            <h2 class="accordion-header">
              <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#sectionTransmitter" aria-expanded="true" aria-controls="sectionTransmitter">
                Site / Transmitter
              </button>
            </h2>
            <div id="sectionTransmitter" class="accordion-collapse collapse show">
              <div class="accordion-body">
                <Transmitter />
              </div>
            </div>
          </div>
          <div class="accordion-item">
            <h2 class="accordion-header">
              <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#sectionReceiver" aria-expanded="false" aria-controls="sectionReceiver">
                Receiver
              </button>
            </h2>
            <div id="sectionReceiver" class="accordion-collapse collapse">
              <div class="accordion-body">
                <Receiver />
              </div>
            </div>
          </div>
          <div class="accordion-item">
            <h2 class="accordion-header">
              <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#sectionEnvironment" aria-expanded="false" aria-controls="sectionEnvironment">
                Environment
              </button>
            </h2>
            <div id="sectionEnvironment" class="accordion-collapse collapse">
              <div class="accordion-body">
                <Environment />
              </div>
            </div>
          </div>
          <div class="accordion-item">
            <h2 class="accordion-header">
              <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#sectionSimulation" aria-expanded="false" aria-controls="sectionSimulation">
                Simulation Options
              </button>
            </h2>
            <div id="sectionSimulation" class="accordion-collapse collapse">
              <div class="accordion-body">
                <Simulation />
              </div>
            </div>
          </div>
          <div class="accordion-item">
            <h2 class="accordion-header">
              <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#sectionDisplay" aria-expanded="true" aria-controls="sectionDisplay">
                Display
              </button>
            </h2>
            <div id="sectionDisplay" class="accordion-collapse collapse show">
              <div class="accordion-body">
                <Display />
              </div>
            </div>
          </div>
        </div>

        <div class="mt-3 d-flex gap-2">
          <button :disabled="store.simulationState === 'running'" @click="store.runSimulation" type="button" class="btn btn-primary mt-run-btn flex-grow-1" id="runSimulation">
            <span :class="{ 'd-none': store.simulationState !== 'running' }" class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            <span class="button-text">{{ buttonText() }}</span>
          </button>
          <button v-if="store.simulationState === 'running'" @click="store.cancelSimulation" type="button" class="btn btn-outline-light mt-run-btn">
            Cancel
          </button>
        </div>

        <div v-if="store.progress" class="mt-2" aria-live="polite">
          <div class="progress mt-progress">
            <div class="progress-bar" role="progressbar"
              :style="{ width: (store.progress.fraction * 100).toFixed(1) + '%' }"
              :aria-valuenow="Math.round(store.progress.fraction * 100)" aria-valuemin="0" aria-valuemax="100"></div>
          </div>
          <small class="mt-progress-label">{{ progressLabel() }}</small>
        </div>

        <div v-if="store.simulationState === 'failed' && store.errorMessage" class="mt-alert-error mt-2 p-2 small" role="alert">
          {{ store.errorMessage }}
        </div>

        <div v-if="store.localSites.length" class="mt-4">
          <div class="mt-sites-heading mb-2">Simulated sites</div>
          <ul class="list-group mt-site-list">
            <li class="list-group-item" v-for="(site, index) in store.$state.localSites" :key="site.id">
              <button type="button" class="mt-site-link text-truncate" @click="store.focusSite(index)" :title="`Go to ${site.params.transmitter.name}`">
                <span class="mt-site-dot" aria-hidden="true"></span>{{ site.params.transmitter.name }}
              </button>
              <button type="button" @click="store.removeSite(index)" class="btn-close" :aria-label="`Remove ${site.params.transmitter.name}`"></button>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div id="map" ref="map">
    </div>

    <div v-if="store.placingMode" class="mt-place-hint" role="status">
      <span><span class="mt-place-dot"></span>Click the map to place the transmitter</span>
      <button type="button" class="mt-place-cancel" @click="store.cancelPlaceOnMap()">Cancel (Esc)</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import "bootstrap/dist/js/bootstrap.bundle.min.js"
import Transmitter from "./components/Transmitter.vue"
import Receiver from "./components/Receiver.vue"
import Environment from "./components/Environment.vue"
import Simulation from "./components/Simulation.vue"
import Display from "./components/Display.vue"

import { useStore } from './store.ts'
const store = useStore()
const buttonText = () => {
  if ('running' === store.simulationState) {
    return 'Running'
  } else if ('failed' === store.simulationState) {
    return 'Failed'
  } else {
    return 'Run Simulation'
  }
}
const progressLabel = () => {
  const p = store.progress
  if (!p) return ''
  if (p.phase === 'terrain') return `Downloading terrain (${p.completed}/${p.total} tiles)`
  if (p.phase === 'compute') return `Computing coverage (${Math.round(p.fraction * 100)}%)`
  return 'Rendering...'
}
</script>
