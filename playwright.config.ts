import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? "http://127.0.0.1:5660";
const releaseArtifactDirectory = process.env.RELEASE_E2E_ARTIFACT_DIR;

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  outputDir: releaseArtifactDirectory
    ? `${releaseArtifactDirectory}/test-results`
    : undefined,
  reporter: releaseArtifactDirectory
    ? [
        ["line"],
        ["json", { outputFile: `${releaseArtifactDirectory}/results.json` }],
        [
          "html",
          {
            outputFolder: `${releaseArtifactDirectory}/playwright-report`,
            open: "never",
          },
        ],
      ]
    : undefined,
  // WSL Compose 验证传入 PLAYWRIGHT_BASE_URL 后，不能再由 Playwright 启动本地开发服务器。
  webServer: externalBaseURL
    ? undefined
    : {
        command: process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
