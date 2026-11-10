import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const origin = 'http://127.0.0.1:' + (process.env.BACK_OFFICE_VERIFICATION_TEST_PORT ?? '8794');
export default defineConfig({
  testDir: './tests',
  testMatch: 'verification-live.spec.ts',
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  outputDir: '../test-results/verification',
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
    command: 'node scripts/serve-verification-test.ts',
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    url: origin + '/health/ready',
    reuseExistingServer: false,
    timeout: 20000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
