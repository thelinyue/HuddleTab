import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.HUDDLETAB_E2E_BASE_URL;
if (!baseURL) throw new Error("缺少隔离验收服务 HUDDLETAB_E2E_BASE_URL。");

/** 使用真实 API 验证认领及审批；不同视口串行共用本任务的隔离服务。 */
export default defineConfig({
  testDir: "./e2e", testMatch: "guest-claim.spec.ts",
  outputDir: "./artifacts/guest-claim", workers: 1, retries: 0, reporter: "list",
  use: { baseURL, locale: "zh-CN", timezoneId: "Asia/Shanghai", serviceWorkers: "block", screenshot: "only-on-failure", trace: "off" },
  projects: [
    ...[320, 390, 1440].map((width) => ({ name: `chromium-${width}`, use: { ...devices[width < 640 ? "Pixel 5" : "Desktop Chrome"], viewport: { width, height: width === 320 ? 568 : 900 } } })),
    { name: "webkit-iphone", use: { ...devices["iPhone 13"] } },
  ],
});
