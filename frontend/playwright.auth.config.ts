import { defineConfig, devices } from "@playwright/test";

/** 认证入口使用隔离接口夹具，覆盖短屏、常见手机和桌面；不依赖真实账号或修改服务器数据。 */
export default defineConfig({
  testDir: "./e2e", testMatch: "auth-layout.spec.ts",
  outputDir: "./artifacts/auth-layout", workers: 2, reporter: "list",
  webServer: { command: "npm run preview -- --port 4181", url: "http://localhost:4181", reuseExistingServer: !process.env.CI },
  use: { baseURL: "http://localhost:4181", locale: "zh-CN", timezoneId: "Asia/Shanghai", serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: ["light", "dark"].flatMap((theme) => {
    const colorScheme = theme as "light" | "dark";
    return [
      ...[{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1440, height: 1000 }].map((viewport) => ({
        name: `chromium-${viewport.width}-${theme}`,
        use: { ...devices[viewport.width < 640 ? "Pixel 5" : "Desktop Chrome"], viewport, colorScheme },
      })),
      { name: `webkit-iphone-${theme}`, use: { ...devices["iPhone 13"], colorScheme } },
    ];
  }),
});
