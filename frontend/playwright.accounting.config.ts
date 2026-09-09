import { defineConfig, devices } from '@playwright/test';

/** 生产前端与确定性接口夹具验证布局、异步交互和图片；真实后端由 Phase 1E 验收。 */
export default defineConfig({
  testDir: './e2e', testMatch: 'accounting-experience.spec.ts', outputDir: './artifacts/accounting-browser',
  timeout: 30_000, workers: 1, reporter: [['list']],
  webServer: { command: 'npm run preview -- --port 4173', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
  use: { baseURL: 'http://localhost:4173', locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
    { name: 'chromium-compact', use: { ...devices['Pixel 5'], viewport: { width: 320, height: 568 } } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
  ],
});
