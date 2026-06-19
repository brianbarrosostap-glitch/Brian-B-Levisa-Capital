import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',          // new deploys update the SW silently
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Levisa Capital — Invoice Factoring',
        short_name: 'Levisa Capital',
        description: 'Invoice factoring portal for Levisa Capital.',
        theme_color: '#007953',
        background_color: '#072418',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App-shell only: precache the built JS/CSS/icons so the app installs
        // and loads instantly offline. We deliberately DO NOT cache any
        // Supabase requests — this is a live financial app, so data must
        // always come fresh from the network (never show stale invoice $).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            // Any Supabase call (REST, auth, edge functions) → NetworkOnly.
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: false,   // don't run the SW in `npm run dev` (avoids cache headaches)
      },
    }),
  ],
})
