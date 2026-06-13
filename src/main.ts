import { createApp } from 'vue'
// Import order matters: the theme in style.css overrides Bootstrap.
import 'bootstrap/dist/css/bootstrap.min.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import App from './App.vue'
import { createPinia } from 'pinia'

const app = createApp(App)
app.use(createPinia())

app.mount('#app')
