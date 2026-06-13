import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [vue()],
  // Relative asset paths in production so the build works unchanged at the
  // default GitHub Pages project URL (…github.io/meshtastic-site-planner/)
  // AND at a custom domain root (site.meshtastic.org). The app has no
  // client-side routing, so a relative base is safe. Dev stays at '/'.
  base: command === 'build' ? './' : '/',
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}))
