import { defineConfig } from '@playwright/test'

/**
 * E2E smoke tests (plan §11.7) against the Vite DEV server (no production
 * build). Uses the system Microsoft Edge (`channel: 'msedge'`), so no browser
 * download is needed. Port 5176 with its own deps cache, so it never touches
 * a dev server already running on :5173.
 */
const PORT = 5176

// Headless WebGL2 on any GPU (or SwiftShader); ANGLE over D3D11 on Windows.
const GPU_ARGS = ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
if (process.platform === 'win32') GPU_ARGS.push('--use-angle=d3d11')

export default defineConfig({
  testDir: 'e2e',
  // One WebGL scene at a time: a cold dev server compiles three/R3F on the first visit.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    launchOptions: { args: GPU_ARGS },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { VITE_CACHE_DIR: 'node_modules/.vite-e2e' },
  },
})
