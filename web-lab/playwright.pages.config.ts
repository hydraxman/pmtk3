import { defineConfig } from '@playwright/test';
import { browserLaunchOptions } from './scripts/browser';

export default defineConfig({
  testDir: './tests/pages', workers: 1, timeout: 90_000, expect: { timeout: 15_000 },
  reporter: 'list', outputDir: 'test-results/pages-runtime',
  use: { baseURL: process.env.PAGES_TEST_URL ?? 'http://127.0.0.1:4184/pmtk3/',
    headless: true, screenshot: 'only-on-failure', launchOptions: browserLaunchOptions() },
  webServer: process.env.PAGES_TEST_URL ? undefined : {
    command: 'npm run pages:preview', url: 'http://127.0.0.1:4184/pmtk3/',
    reuseExistingServer: true, timeout: 30_000,
  },
});
