import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [vue(), tailwindcss()],
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
    rollupOptions: {
      output: {
        // Split the big, stable vendors into their own chunks so they load in
        // parallel with the app code and stay cached across app-only deploys
        // (#16). The WASM engine is split separately via a dynamic import.
        manualChunks(id: string) {
          if (id.includes('node_modules/maplibre-gl')) return 'maplibre';
          if (/node_modules\/(@vue|vue|pinia|@vueuse)\//.test(id)) return 'vue';
        },
      },
    },
    // maplibre-gl is ~1 MB (283 kB gzip) and can't be split further; it now
    // lives in its own cacheable chunk, so raise the limit past it.
    chunkSizeWarningLimit: 1100,
  },
}))
