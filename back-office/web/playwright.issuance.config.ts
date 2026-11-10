import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const origin = 'http://127.0.0.1:' + (process.env.BACK_OFFICE_ISSUANCE_TEST_PORT ?? 8793);
export default defineConfig({
  testDir: './tests',
  testMatch: 'issuance-live.spec.ts',
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  outputDir: '../test-results/issuance',
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
    command: 'node scripts/serve-issuance-test.ts',
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    url: origin + '/health/ready',
    reuseExistingServer: false,
    timeout: 20000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
