import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']},
    },
    {
      name: 'mobile-chrome',
      use: {...devices['Pixel 7']},
    },
  ],
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --port 5173',
    reuseExistingServer: true,
    timeout: 30_000,
    url: 'http://127.0.0.1:5173',
  },
});
