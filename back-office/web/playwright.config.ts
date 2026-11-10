import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const origin = 'http://127.0.0.1:' + (process.env.BACK_OFFICE_WEB_TEST_PORT ?? '8789');
export default defineConfig({
  testDir: './tests',
  testMatch: ['console.spec.ts', 'governance.spec.ts'],
  fullyParallel: true,
  timeout: 20_000,
  workers: 2,
  reporter: 'list',
  outputDir: '../test-results/web',
  use: {
    baseURL: origin,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 960 },
    locale: 'sk-SK',
    timezoneId: 'Europe/Bratislava',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-console-test.ts',
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    url: origin + '/',
    timeout: 20_000,
    reuseExistingServer: false,
  },
});
