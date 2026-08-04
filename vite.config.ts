import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { serviceWorkerPlugin } from './build/service-worker-plugin.ts'

// GitHub Pages serves the app from /<repo>/. CI passes the repo name through
// BASE_PATH so the same config also works for a custom domain (BASE_PATH=/).
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), serviceWorkerPlugin()],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    cssTarget: 'chrome111',
    sourcemap: true,
    // The export renderer and the duel engine are only pulled in on demand,
    // so keep the entry chunk to the editor itself.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    // The OBS overlay runs in a second window/browser source that talks to the
    // editor over BroadcastChannel; both must be same-origin.
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts', 'src/store/**/*.ts'],
    },
  },
})
