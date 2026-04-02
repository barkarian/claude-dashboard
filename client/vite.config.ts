import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  base: './', // relative assets — works under any path prefix
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.svg', 'icon-512.svg'],
      manifest: {
        name: 'Claude Dashboard',
        short_name: 'Claude Dash',
        start_url: './',
        display: 'standalone',
        background_color: '#0f1117',
        theme_color: '#6366f1',
        icons: [
          { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // Exclude HTML from precache — Express injects <base href> at runtime,
        // so the SW must not serve a cached copy without it.
        globPatterns: ['**/*.{js,css,ico,png,svg}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MB
        // No navigateFallback — let Express handle navigation requests
        // (it injects the correct <base href="/${env}/"> tag).
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      shared: path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    allowedHosts: ['.ngrok-free.app', '.ngrok.io'],
    proxy: {
      '/api': 'http://localhost:2222',
      '/local/api': 'http://localhost:2222',
      '/vps/api': 'http://localhost:2222',
      '/socket.io': { target: 'http://localhost:2222', ws: true },
      '/local/socket.io': { target: 'http://localhost:2222', ws: true },
      '/vps/socket.io': { target: 'http://localhost:2222', ws: true },
    },
  },
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
    rollupOptions: {
      external: ['@capawesome/capacitor-badge'],
    },
  },
});
