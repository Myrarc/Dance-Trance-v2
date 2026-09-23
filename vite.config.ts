import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // The only large JS chunk is MediaBunny's decoder, loaded on demand by song analysis.
  build: { chunkSizeWarningLimit: 700 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['logo.png', 'home-background.webp', 'fonts/trance-display-heavy.woff2'],
      manifest: {
        name: 'Dance Trance',
        short_name: 'Dance Trance',
        description: 'Turn any dance video into a private one or two-player rhythm game.',
        theme_color: '#ff5f6d',
        background_color: '#fff4d8',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: '/pwa-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/pwa-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/(?:models|wasm)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dance-trance-pose-assets',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
