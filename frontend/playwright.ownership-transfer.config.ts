import { defineConfig, devices } from "@playwright/test";

/** 使用独立预览和模拟接口验证转让 Sheet，避免布局测试实际变更活动所有权。 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "ownership-transfer-layout.spec.ts",
  outputDir: "./artifacts/ownership-transfer",
  workers: 1,
  reporter: "list",
  webServer: { command: "npm run preview -- --host 127.0.0.1 --port 4176 --strictPort", url: "http://127.0.0.1:4176", reuseExistingServer: false },
  use: { baseURL: "http://127.0.0.1:4176", locale: "zh-CN", timezoneId: "Asia/Shanghai", serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: ["chromium", "webkit"].flatMap((browser) => [320, 390, 430, 1440].map((width) => ({
    name: `${browser}-${width}`,
    use: {
      ...devices[browser === "webkit" ? (width < 640 ? "iPhone 13" : "Desktop Safari") : (width < 640 ? "Pixel 5" : "Desktop Chrome")],
      viewport: { width, height: width === 320 ? 568 : width === 430 ? 932 : 1000 },
    },
  }))),
});
