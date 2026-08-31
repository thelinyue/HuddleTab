import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

it("Playwright 配置不再包含发布产物门禁", async () => {
  const config = await readFile("playwright.config.ts", "utf8");

  expect(config).toContain("PLAYWRIGHT_BASE_URL");
  expect(config).not.toContain("RELEASE_E2E_ARTIFACT_DIR");
  expect(config).not.toMatch(/^\s*outputDir\s*:/m);
  expect(config).not.toMatch(/^\s*reporter\s*:/m);
});
