import { defineConfig } from '@playwright/test';

// e2e runs the real app on fake providers against the TEST database (tables get wiped).
const PORT = 3100;

export default defineConfig({
  testDir: 'e2e',
  // next dev on /mnt/d (WSL) takes 10-20 s per cold route; the whole flow touches ~10 routes.
  timeout: 360_000,
  workers: 1,
  // next dev compiles each route on first hit, so the 5 s default flakes.
  expect: { timeout: 30_000 },
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      E2E_AUTH: '1',
      NEXT_PUBLIC_E2E_AUTH: '1',
      TRANSCRIBE_PROVIDER: 'fake',
      GENERATE_PROVIDER: 'fake',
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
    },
  },
});
