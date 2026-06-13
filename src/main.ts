import { createApp } from 'vue'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import App from './App.vue'
import { createPinia } from 'pinia'

const app = createApp(App)
app.use(createPinia())

app.mount('#app')
