import { createApp } from 'vue'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import App from './App.vue'
import { createPinia } from 'pinia'
import { saveParams } from './persist'

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
