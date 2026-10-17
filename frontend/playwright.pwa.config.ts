import { defineConfig, devices } from "@playwright/test";

/** 直接运行生产构建的 Service Worker，测试自行启动仅供浏览器夹具使用的本地服务。 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "pwa-update.spec.ts",
  outputDir: "./artifacts/pwa-browser",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { locale: "zh-CN", timezoneId: "Asia/Shanghai", serviceWorkers: "allow", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "chromium-compact", use: { ...devices["Pixel 5"], viewport: { width: 320, height: 568 } } },
  ],
});
