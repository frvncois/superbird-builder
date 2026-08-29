import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // publish API + media library bytes live in the node server (npm run serve).
    // Object form (changeOrigin defaults to false) preserves the browser's
    // Host header so the server's same-origin check (Origin host === Host)
    // passes in dev — the string shorthand rewrites Host to the target and
    // every mutating request 403s with "cross-origin request rejected".
    proxy: {
      '/api': { target: 'http://localhost:4174' },
      '/media': { target: 'http://localhost:4174' },
    },
  },
})
