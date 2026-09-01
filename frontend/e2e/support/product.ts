import { expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

export async function installArtifactVisualRedaction(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const apply = () => {
      if (document.querySelector("style[data-e2e-sensitive-mask]")) return;
      const style = document.createElement("style");
      style.dataset.e2eSensitiveMask = "true";
      // 失败截图仍可用于定位布局，但账号字段和成员显示名不以可读文本进入图片。
      style.textContent = `
        input[autocomplete="username"],
        input[autocomplete="current-password"],
        input[autocomplete="new-password"],
        .profile-panel strong,
        .profile-panel small,
        .member-input-list span {
          color: transparent !important;
          text-shadow: 0 0 8px currentColor !important;
        }
      `;
      document.documentElement.append(style);
    };
    if (document.documentElement) apply();
    else document.addEventListener("DOMContentLoaded", apply, { once: true });
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

export async function login(page: Page): Promise<void> {
  const { username, password } = credentials();
  await installArtifactVisualRedaction(page.context());
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: "登录" }).click();
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
