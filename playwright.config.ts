import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

// Smoke-only e2e. The server is started on an isolated data dir (SB_DATA_DIR)
// and a non-default port so it never touches real dev data or a running
// `npm run serve`. Requires a prior `npm run build` (the SPA is served from
// dist/) — CI runs the build gate first.
const PORT = 4188
// absolute: the exporter's write-path backstop rejects a relative data dir
const DATA_DIR = resolve(import.meta.dirname, '.e2e-data')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // wipe the throwaway data dir, then serve the built SPA + API on an
    // isolated port/data dir
    command: `node -e "require('fs').rmSync(process.env.SB_DATA_DIR,{recursive:true,force:true})" && node server/index.mjs`,
    env: { SB_DATA_DIR: DATA_DIR, PORT: String(PORT) },
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
