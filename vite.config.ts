/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.glb'],
  // A second dev server (Playwright e2e on :5176) gets its own deps cache so it
  // never re-optimizes under the one already running on :5173.
  cacheDir: process.env.VITE_CACHE_DIR || undefined,
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Playwright specs (e2e/*.spec.ts) run with `npm run test:e2e`, never under vitest.
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
