import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const origin = 'http://127.0.0.1:' + (process.env.BACK_OFFICE_IDENTITY_TEST_PORT ?? '8790');
export default defineConfig({
  testDir: './tests',
  testMatch: 'identity-live.spec.ts',
  workers: 1,
  timeout: 20_000,
  reporter: 'list',
  outputDir: '../test-results/identity',
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
    command: 'node scripts/serve-identity-test.ts',
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    url: origin + '/health/ready',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    timeout: 20_000,
  },
});
