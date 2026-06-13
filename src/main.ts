import { createApp } from 'vue'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import App from './App.vue'
import { createPinia } from 'pinia'
import { saveParams } from './persist'
import { useStore } from './store'

const app = createApp(App)
const pinia = createPinia()

// Persist the site parameters across reloads (#12): debounced so rapid edits
// (slider drags, typing) collapse into one write.
pinia.use(({ store }) => {
  if (store.$id !== 'store') return
  let timer: ReturnType<typeof setTimeout> | undefined
  store.$subscribe((_mutation, state) => {
    clearTimeout(timer)
    timer = setTimeout(() => saveParams(state.splatParams), 400)
  })
})

app.use(pinia)
app.mount('#app')

// A shared permalink (#9) was applied during store init; persist it and clear
// the hash so subsequent edits win on the next reload.
useStore(pinia).consumeSharedLink()

// Register the PWA service worker (#11) in production only, so it never
// intercepts Vite's dev server or HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}

