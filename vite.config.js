import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  },
  build: {
    // Inline small assets to reduce HTTP requests on RPi
    assetsInlineLimit: 8192,
    // Target modern Chromium (Electron) — smaller output, no polyfills
    target: 'esnext',
    // Reduce source map overhead in production
    sourcemap: false,
  },
})
