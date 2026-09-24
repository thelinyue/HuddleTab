import { defineConfig, devices } from "@playwright/test";

/** 币种轮播只改变前端展示，使用隔离接口夹具验证原生滚动和筛选联动。 */
export default defineConfig({
  testDir: "./e2e", testMatch: "activity-currency.spec.ts",
  outputDir: "./artifacts/activity-currency", workers: 1, reporter: "list",
  webServer: { command: "npm run preview -- --port 4175", url: "http://localhost:4175", reuseExistingServer: !process.env.CI },
  use: { baseURL: "http://localhost:4175", locale: "zh-CN", timezoneId: "Asia/Shanghai", serviceWorkers: "block", screenshot: "only-on-failure" },
  projects: [
    ...[320, 390, 430, 1440].map((width) => ({ name: `chromium-${width}`, use: { ...devices[width < 500 ? "Pixel 5" : "Desktop Chrome"], viewport: { width, height: 900 } } })),
    { name: "webkit-iphone", use: { ...devices["iPhone 13"] } },
  ],
});
