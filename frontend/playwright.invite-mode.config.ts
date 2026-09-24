import { defineConfig, devices } from "@playwright/test";

/** 隔离接口验证加入方式浮层，浏览器验收不修改真实活动设置。 */
export default defineConfig({
  testDir: "./e2e", testMatch: "invite-mode-popover.spec.ts",
  outputDir: "./artifacts/invite-mode", workers: 1, reporter: "list",
  webServer: { command: "npm run preview -- --host 127.0.0.1 --port 4177 --strictPort", url: "http://127.0.0.1:4177", reuseExistingServer: false },
  use: { baseURL: "http://127.0.0.1:4177", locale: "zh-CN", timezoneId: "Asia/Shanghai", serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    ...[320, 390, 430, 1440].map((width) => ({ name: `chromium-${width}`, use: { ...devices[width < 640 ? "Pixel 5" : "Desktop Chrome"], viewport: { width, height: width === 320 ? 568 : 932 } } })),
    { name: "webkit-iphone", use: { ...devices["iPhone 13"] } },
  ],
});
