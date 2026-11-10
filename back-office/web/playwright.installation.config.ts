import { defineConfig } from '@playwright/test';

if (!process.env.BACK_OFFICE_ACCEPTANCE_ORIGIN || !process.env.BACK_OFFICE_ACCEPTANCE_STATE_FILE)
  throw new Error('Run the installation API check against a disposable ordinary stack first.');
export default defineConfig({
  testDir: './tests',
  testMatch: 'installation-live.spec.ts',
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  outputDir: '../test-results/installation',
  use: {
    baseURL: process.env.BACK_OFFICE_ACCEPTANCE_ORIGIN,
    browserName: 'chromium',
    headless: true,
    locale: 'sk-SK',
    timezoneId: 'Europe/Bratislava',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
