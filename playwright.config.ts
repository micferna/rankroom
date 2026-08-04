import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against a real browser, because the things they cover —
 * pointer drag and drop, canvas exports, `<dialog>` behaviour — are exactly the
 * things jsdom cannot answer for. Everything else is unit-tested in `src/lib`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'on-first-retry',
    // The app is French or English depending on the browser; pin it so the
    // assertions do not depend on the machine running them.
    locale: 'en-GB',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    // --host is load-bearing: without it Vite binds `localhost`, which resolves
    // to ::1 first on CI runners while Playwright polls 127.0.0.1, and the wait
    // simply times out. It works locally, which is what makes it easy to miss.
    command: 'npm run preview -- --port 5174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
