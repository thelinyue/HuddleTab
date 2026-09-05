import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type TestInfo } from "@playwright/test";

import { assertNoHorizontalOverflow, credentials, installArtifactVisualRedaction, login, saveChromiumSuccessScreenshot } from "./support/product";

async function openRegistrationPolicy(page: Page, policy: "开放注册" | "仅允许邀请注册"): Promise<void> {
  await page.goto("/admin/settings");
  const settings = page.getByRole("main");
  // 管理页面使用整页 Sheet 风格，等待当前策略读取后再点击，避免把刷新竞态当成保存成功。
  await expect(settings.getByLabel(policy)).toBeVisible();
  await settings.getByLabel(policy, { exact: true }).click();
  await expect(settings.getByLabel(policy, { exact: true })).toBeChecked();
}

async function registerOpenUser(browser: Browser, testInfo: TestInfo): Promise<{ context: BrowserContext; page: Page; username: string; password: string; displayName: string }> {
  const context = await browser.newContext(testInfo.project.use as BrowserContextOptions);
  await installArtifactVisualRedaction(context);
  const page = await context.newPage();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const username = `task29${suffix}`.slice(0, 32);
  const password = `${crypto.randomUUID()}Aa1!`;
  const displayName = `Task29-${suffix.slice(0, 6)}`;
  await page.goto("/register");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("昵称").fill(displayName);
  await page.locator('input[autocomplete="new-password"]').fill(password);
  await page.getByRole("button", { name: "注册并继续" }).click();
  await expect(page.getByRole("heading", { name: "活动", exact: true })).toBeVisible();
  return { context, page, username, password, displayName };
}

test("系统管理员入口、账号管理和注册策略保持 v0.0.2 交互密度", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  const admin = credentials();
  await login(page);

  await page.goto("/me");
  await expect(page.getByRole("link", { name: "系统管理" })).toBeVisible();
  await page.getByRole("link", { name: "系统管理" }).click();
  await expect(page.getByRole("heading", { name: "系统管理" })).toBeVisible();
  await page.getByRole("link", { name: "用户管理" }).click();
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();

  await page.goto("/admin/settings");
  await openRegistrationPolicy(page, "开放注册");
  const newUser = await registerOpenUser(browser, testInfo);
  try {
    // 普通账号仍可登录活动工作台，但直接打开管理路径会回到“我的”。
    await newUser.page.goto("/admin");
    await expect(newUser.page).toHaveURL(/\/me$/);
    await expect(newUser.page.getByRole("link", { name: "系统管理" })).toHaveCount(0);

    await page.goto("/admin/users");
    const row = page.locator(".admin-user-row").filter({ hasText: newUser.displayName });
    await expect(row).toBeVisible();

    // 重置目标账号后，旧 Session 必须失效；随后可用新密码重新登录。
    await row.getByRole("button", { name: "重置密码" }).click();
    const reset = page.getByRole("dialog", { name: "重置密码" });
    const replacement = `${crypto.randomUUID()}Bb2!`;
    await reset.getByLabel("新密码", { exact: true }).fill(replacement);
    await reset.getByLabel("确认新密码", { exact: true }).fill(replacement);
    await reset.getByRole("button", { name: "确认重置" }).click();
    await expect(reset).toBeHidden();
    await newUser.page.goto("/activities");
    await expect(newUser.page).toHaveURL(/\/login$/);
    await newUser.page.getByLabel("用户名").fill(newUser.username);
    await newUser.page.locator('input[autocomplete="current-password"]').fill(replacement);
    await newUser.page.getByRole("button", { name: "登录" }).click();
    await expect(newUser.page.getByRole("heading", { name: "活动", exact: true })).toBeVisible();

    // 只有一个管理员时，禁用自己必须被事务不变量拒绝，页面保留用户列表。
    const adminRow = page.locator(".admin-user-row").filter({ hasText: admin.username });
    await expect(adminRow).toBeVisible();
    await adminRow.getByRole("button", { name: "禁用" }).click();
    await expect(page.getByRole("alert")).toContainText("至少保留一个");
    await expect(adminRow).toContainText("正常");

    await openRegistrationPolicy(page, "仅允许邀请注册");
    const rejectedContext = await browser.newContext(testInfo.project.use as BrowserContextOptions);
    await installArtifactVisualRedaction(rejectedContext);
    const rejected = await rejectedContext.newPage();
    try {
      const rejectedUsername = `blocked${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`.slice(0, 32);
      const rejectedPassword = `${crypto.randomUUID()}Cc3!`;
      const submitRejectedRegistration = async () => {
        await rejected.goto("/register");
        await rejected.getByLabel("用户名").fill(rejectedUsername);
        await rejected.getByLabel("昵称").fill("Blocked");
        await rejected.locator('input[autocomplete="new-password"]').fill(rejectedPassword);
        const responsePromise = rejected.waitForResponse((response) => response.url().includes("/api/auth/register") && response.request().method() === "POST");
        await rejected.getByRole("button", { name: "注册并继续" }).click();
        return responsePromise;
      };
      let rejectedResponse = await submitRejectedRegistration();
      if (rejectedResponse.status() === 429) {
        const retryAfter = Number(rejectedResponse.headers()["retry-after"] ?? "1");
        await rejected.waitForTimeout(Math.max(1, Math.min(retryAfter, 90)) * 1_000 + 250);
        rejectedResponse = await submitRejectedRegistration();
      }
      expect(rejectedResponse.status()).toBe(403);
      await expect(rejected.getByRole("alert")).toContainText("仅允许受邀用户注册");
    } finally {
      await rejectedContext.close();
    }

    await assertNoHorizontalOverflow(page);
    await assertNoHorizontalOverflow(newUser.page);
    await saveChromiumSuccessScreenshot(page, testInfo);
  } finally {
    await newUser.context.close();
  }
});
