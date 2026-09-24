import { defineConfig, devices } from "@playwright/test";

/** 设置与用户管理使用接口夹具验收，不执行真实账号写入；真实后端仍由 Task 29 测试覆盖。 */
export default defineConfig({
  testDir: "./e2e", testMatch: ["admin-users.spec.ts", "settings-redesign.spec.ts"], outputDir: "./artifacts/admin-users",
  timeout: 30_000, workers: 1, reporter: [["list"]],
  webServer: { command: "npm run preview -- --port 4175", url: "http://localhost:4175", reuseExistingServer: !process.env.CI },
  use: { baseURL: "http://localhost:4175", locale: "zh-CN", timezoneId: "Asia/Shanghai", serviceWorkers: "block", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "chromium-mobile", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } } },
    { name: "chromium-compact", use: { ...devices["Pixel 5"], viewport: { width: 320, height: 568 } } },
    { name: "chromium-wide-mobile", use: { ...devices["Pixel 5"], viewport: { width: 430, height: 932 } } },
    { name: "webkit-iphone", use: { ...devices["iPhone 13"] } },
  ],
});
