import { defineConfig, devices } from '@playwright/test';

/** AI 智能录入只使用浏览器路由夹具，不连接真实 Provider。 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'ai-expense-entry.spec.ts',
  outputDir: './artifacts/ai-expense-browser',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
  ],
});
