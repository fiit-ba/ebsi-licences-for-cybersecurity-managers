import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const origin = 'http://127.0.0.1:' + (process.env.BACK_OFFICE_ORGANIZATION_TEST_PORT ?? 8791);
export default defineConfig({
  testDir: './tests',
  testMatch: 'organizations-live.spec.ts',
  workers: 1,
  timeout: 25_000,
  reporter: 'list',
  outputDir: '../test-results/organizations',
  use: {
    baseURL: origin,
    browserName: 'chromium',
    headless: true,
    locale: 'sk-SK',
    timezoneId: 'Europe/Bratislava',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-organization-test.ts',
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    url: origin + '/health/ready',
    reuseExistingServer: false,
    timeout: 20_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
