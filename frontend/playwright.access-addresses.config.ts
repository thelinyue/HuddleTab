import { defineConfig } from "@playwright/test";

// 仅用于可丢弃的新安装实例：本场景会保存并移除访问入口，不接入常规线上验收矩阵。
const baseURL = process.env.HUDDLETAB_E2E_BASE_URL;
if (!baseURL || new URL(baseURL).hostname !== "127.0.0.1") {
  throw new Error("访问地址验收需要 HUDDLETAB_E2E_BASE_URL 指向 127.0.0.1 的可丢弃新安装实例。");
}
export default defineConfig({
  testDir: "./e2e", testMatch: "access-addresses.spec.ts", workers: 1, retries: 0, timeout: 60_000,
  outputDir: "./artifacts/access-addresses-browser", reporter: [["list"]],
  use: { baseURL, locale: "zh-CN", serviceWorkers: "block", screenshot: "only-on-failure", trace: "off" },
});
