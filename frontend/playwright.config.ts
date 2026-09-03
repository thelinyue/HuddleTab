import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const baseURL = process.env.HUDDLETAB_E2E_BASE_URL;

if (!baseURL) {
  throw new Error("缺少 HUDDLETAB_E2E_BASE_URL，请通过 Phase 1E PowerShell 入口运行测试。");
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: path.join(frontendDir, "artifacts", "test-results"),
  workers: 1,
  retries: 0,
  reporter: [["line"], ["html", { outputFolder: path.join(frontendDir, "artifacts", "playwright-report"), open: "never" }]],
  use: {
    baseURL,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      testMatch: "core.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "chromium-mobile",
      testMatch: "core.spec.ts",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "webkit-smoke",
      testMatch: "smoke.spec.ts",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "chromium-attachment-desktop",
      testMatch: "attachment.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "chromium-attachment-mobile",
      testMatch: "attachment.spec.ts",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "chromium-notification-desktop",
      testMatch: "notification-ownership.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "chromium-notification-mobile",
      testMatch: "notification-ownership.spec.ts",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
  ],
});
