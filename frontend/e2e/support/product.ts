import { expect, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";

export async function installArtifactVisualRedaction(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const apply = () => {
      // 失败截图仍可用于定位布局，但账号字段和成员显示名不以可读文本进入图片。
      const selectors = [
        'input[autocomplete="username"]',
        'input[autocomplete="current-password"]',
        'input[autocomplete="new-password"]',
        ".profile-panel strong",
        ".profile-panel small",
        ".member-input-list span",
      ];
      document.querySelectorAll(selectors.join(",")).forEach((element) => {
        element.setAttribute("data-e2e-sensitive-mask", "true");
      });
    };
    if (document.documentElement) {
      apply();
      new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
    } else document.addEventListener("DOMContentLoaded", apply, { once: true });
  });
}

export function credentials(): { username: string; password: string } {
  const username = process.env.HUDDLETAB_E2E_USERNAME;
  const password = process.env.HUDDLETAB_E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("缺少 E2E 临时凭据，请通过 Phase 1E PowerShell 入口运行测试。");
  }
  return { username, password };
}

export async function assertCredentialFieldsVisuallyMasked(page: Page): Promise<void> {
  const { username, password } = credentials();
  await installArtifactVisualRedaction(page.context());
  await page.goto("/login");
  const fields: Array<{ label: string; locator: Locator; value: string }> = [
    { label: "用户名", locator: page.getByLabel("用户名"), value: username },
    { label: "密码", locator: page.locator('input[autocomplete="current-password"]'), value: password },
  ];
  for (const field of fields) {
    // CSP 不允许测试注入 inline <style>；在截图前同步补上 CSS 标记，避免
    // MutationObserver 尚未调度时把临时账号写入 Playwright artifact。
    await field.locator.evaluate((element) => element.setAttribute("data-e2e-sensitive-mask", "true"));
    await field.locator.fill("x".repeat(field.value.length));
    const referencePixels = await field.locator.screenshot({ animations: "disabled", caret: "hide" });
    await field.locator.fill(field.value);
    const credentialPixels = await field.locator.screenshot({ animations: "disabled", caret: "hide" });
    expect(credentialPixels, `${field.label}输入框的真实凭据仍改变了截图像素。`).toEqual(referencePixels);
  }
}

export async function login(page: Page): Promise<void> {
  const { username, password } = credentials();
  await installArtifactVisualRedaction(page.context());
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const loginResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/auth/login"));
  await page.getByRole("button", { name: "登录" }).click();
  const response = await loginResponse;
  if (response.status() === 429) {
    // 完整发布矩阵共用一个生产限流桶；遇到窗口限制时按 Retry-After 等待后重试，
    // 不修改服务端限流规则，也不把临时凭据写入日志或命令行。
    const retryAfter = Number.parseInt(response.headers()["retry-after"] ?? "60", 10);
    await page.waitForTimeout((Number.isFinite(retryAfter) ? Math.max(1, retryAfter) : 60) * 1000 + 500);
    await page.goto("/login");
    await page.getByLabel("用户名").fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "登录" }).click();
  }
  await expect(page.getByRole("heading", { name: "活动", exact: true })).toBeVisible();
}

export async function createActivity(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: "创建活动" }).first().click();
  const dialog = page.getByRole("dialog", { name: "创建活动" });
  await dialog.getByLabel("活动名称").fill(name);
  await dialog.getByRole("button", { name: "创建活动", exact: true }).click();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, `页面横向溢出：${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.clientWidth);
}

export async function saveChromiumSuccessScreenshot(page: Page, testInfo: TestInfo): Promise<void> {
  if (!testInfo.project.name.startsWith("chromium-")) return;
  const path = testInfo.outputPath("core-success.png");
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach("Chromium 核心流程成功态", { path, contentType: "image/png" });
}
