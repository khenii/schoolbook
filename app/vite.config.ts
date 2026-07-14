import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Note: PowerSync's web SDK runs SQLite via WASM in a web worker. If `npm
// run dev` throws a worker/wasm-related error, check PowerSync's current
// web integration docs — this config detail changes across SDK versions.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      devOptions: {
        enabled: true // serve the manifest/SW in dev too, since testing
        // offline behavior early matters for this app
      },
      manifest: {
        name: 'Schoolbook',
        short_name: 'Schoolbook',
        description: 'Offline-first school fee & records management',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        // App shell + static assets are cached by the service worker.
        // Actual app data lives in PowerSync's local SQLite DB, not here.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}']
      }
    })
  ],
  worker: {
    format: 'es' // required for PowerSync's WASM SQLite worker
  },
  optimizeDeps: {
    exclude: ['@powersync/web']
  }
});
