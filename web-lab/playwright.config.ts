import { defineConfig } from '@playwright/test';
import { browserLaunchOptions } from './scripts/browser';

const launchOptions = browserLaunchOptions();

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  projects: [{ name: launchOptions.channel ?? 'cached-chromium' }],
  outputDir: 'test-results/runtime',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions,
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
