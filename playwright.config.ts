import {defineConfig, devices} from '@playwright/test';

const port = process.env.CRITREV_TEST_PORT ?? '5173';
const baseURL = `http://127.0.0.1:${port}`;

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
    baseURL,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}
      : {},
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    reuseExistingServer: !process.env.CRITREV_PACKAGE_ROOT,
    timeout: 30_000,
    url: `${baseURL}/images.html`,
  },
});
