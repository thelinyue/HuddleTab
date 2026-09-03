import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type TestInfo } from "@playwright/test";

import { assertNoHorizontalOverflow, installArtifactVisualRedaction, login, saveChromiumSuccessScreenshot } from "./support/product";

async function registerOpenUser(browser: Browser, testInfo: TestInfo): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(testInfo.project.use as BrowserContextOptions);
  await installArtifactVisualRedaction(context);
  const page = await context.newPage();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  await page.goto("/register");
  await page.getByLabel("用户名").fill(`task31${suffix}`.slice(0, 32));
  await page.getByLabel("显示名称").fill("Task31 普通用户");
  await page.locator('input[autocomplete="new-password"]').fill(`${crypto.randomUUID()}Aa1!`);
  await page.getByRole("button", { name: "注册并继续" }).click();
  await expect(page.getByRole("heading", { name: "活动", exact: true })).toBeVisible();
  return { context, page };
}

test("Task 31 系统信息沿用紧凑管理页且不扩张普通用户权限", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  await login(page);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "系统管理" })).toBeVisible();
  await page.getByRole("link", { name: "系统信息" }).click();
  await expect(page.getByRole("heading", { name: "系统信息" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "存储使用" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "运行信息" })).toBeVisible();
  for (const label of ["数据库", "上传文件", "合计", "应用版本", "PWA 版本", "数据库版本", "数据目录"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  const response = await page.request.get("/api/admin/system-information");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");

  // 临时切到开放注册以创建一个普通账号，随后验证其管理读权限仍被服务端拒绝。
  await page.goto("/admin/settings");
  await expect(page.getByLabel("开放注册", { exact: true })).toBeVisible();
  await page.getByLabel("开放注册", { exact: true }).click();
  await expect(page.getByLabel("开放注册", { exact: true })).toBeChecked();
  const ordinary = await registerOpenUser(browser, testInfo);
  try {
    const denied = await ordinary.page.request.get("/api/admin/storage");
    expect(denied.status()).toBe(403);
    const body = await denied.json();
    expect(body.error.code).toBe("SYSTEM_ADMIN_REQUIRED");
    await assertNoHorizontalOverflow(ordinary.page);
  } finally {
    await ordinary.context.close();
  }

  await assertNoHorizontalOverflow(page);
  await page.goto("/activities");
  await expect(page.getByRole("heading", { name: "活动", exact: true })).toBeVisible();
  await saveChromiumSuccessScreenshot(page, testInfo);
});
