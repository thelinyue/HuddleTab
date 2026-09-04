import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type TestInfo } from "@playwright/test";
import { assertNoHorizontalOverflow, createActivity, installArtifactVisualRedaction, login, saveChromiumSuccessScreenshot } from "./support/product";

type JoinedUser = { context: BrowserContext; page: Page; displayName: string };

async function issueLinkInvitation(page: Page): Promise<string> {
  await page.getByRole("link", { name: /成员 \d+/ }).click();
  const members = page.getByRole("dialog", { name: "成员" });
  await members.getByRole("button", { name: "邀请成员" }).click();
  const invitation = page.getByRole("dialog", { name: "邀请成员" });
  await invitation.getByRole("button", { name: "生成链接邀请" }).click();
  const token = (await invitation.locator(".issued-invite code").textContent())?.trim();
  expect(token).toBeTruthy();
  await invitation.getByRole("button", { name: "关闭邀请成员" }).click();
  return token!;
}

async function registerAndJoin(browser: Browser, testInfo: TestInfo, token: string, label: string): Promise<JoinedUser> {
  const context = await browser.newContext(testInfo.project.use as BrowserContextOptions);
  await installArtifactVisualRedaction(context);
  const page = await context.newPage();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const username = `${label}${suffix}`.slice(0, 30);
  const displayName = `${label}-${suffix.slice(0, 6)}`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const registrationUrl = `/register?invite=${encodeURIComponent(token)}`;
  const submitRegistration = async () => {
    await page.goto(registrationUrl);
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("显示名称").fill(displayName);
    await page.locator('input[autocomplete="new-password"]').fill(password);
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().endsWith("/api/auth/register"),
    );
    await page.getByRole("button", { name: "注册并继续" }).click();
    return responsePromise;
  };
  let response = await submitRegistration();
  if (response.status() === 429) {
    // 完整矩阵共用认证 IP 桶；等待服务端声明的窗口后重放同一注册表单，
    // 不把临时凭据写入测试日志或命令行。
    const retryAfter = Number.parseInt(response.headers()["retry-after"] ?? "60", 10);
    await page.waitForTimeout((Number.isFinite(retryAfter) ? Math.max(1, retryAfter) : 60) * 1000 + 500);
    response = await submitRegistration();
  }
  if (response.status() >= 400) throw new Error(`注册请求失败（HTTP ${response.status()}）。`);
  await expect(page.getByRole("button", { name: "加入活动" })).toBeVisible();
  await page.getByRole("button", { name: "加入活动" }).click();
  return { context, page, displayName };
}

async function changeInviteModeToApproval(page: Page): Promise<void> {
  await page.getByRole("link", { name: "活动管理" }).click();
  const management = page.getByRole("dialog", { name: "活动管理" });
  await management.getByRole("button", { name: "编辑加入方式" }).click();
  const editor = page.getByRole("dialog", { name: "加入方式" });
  await editor.getByRole("button", { name: "需要审批" }).click();
  await editor.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("dialog", { name: "活动管理" })).toBeVisible();
  await page.getByRole("button", { name: "关闭活动管理" }).click();
}

test("通知筛选、加入审批和所有权转让保持同一活动交互层级", async ({ page, browser }, testInfo) => {
  test.setTimeout(60_000);
  const activityName = `Phase 1E 通知-${Date.now()}`;
  await login(page);
  const activityId = await createActivity(page, activityName);
  await expect(page.getByRole("navigation", { name: "活动导航" }).getByRole("link")).toHaveText(["流水", "结算"]);

  const directToken = await issueLinkInvitation(page);
  const member = await registerAndJoin(browser, testInfo, directToken, "member");
  try {
    await expect(member.page.getByRole("heading", { name: activityName })).toBeVisible();
    await page.goto("/notifications");
    await page.reload();
    await expect(page.getByText(`${member.displayName} 已加入活动`)).toBeVisible();
    await expect(page.getByRole("group", { name: "通知筛选" }).getByRole("button")).toHaveText(["全部", "未读", "邀请", "结算", "系统"]);
    await expect(page.getByRole("link", { name: /通知，\d+ 条未读/ })).toBeVisible();

    await page.goto(`/activities/${activityId}`);
    await changeInviteModeToApproval(page);
    const approvalToken = await issueLinkInvitation(page);
    const applicant = await registerAndJoin(browser, testInfo, approvalToken, "applicant");
    try {
      await expect(applicant.page.getByText("等待活动所有者审批")).toBeVisible();
      await page.goto("/notifications");
      await page.reload();
      const request = page.locator(".notification-row").filter({ hasText: `${applicant.displayName} 申请加入活动` });
      await expect(request).toBeVisible();
      await request.getByRole("button", { name: "通过" }).click();
      await expect(request.getByRole("button", { name: "通过" })).toBeHidden();

      await applicant.page.goto("/notifications");
      await expect(applicant.page.getByText("加入申请已批准")).toBeVisible();

      await page.getByRole("button", { name: "全部已读" }).click();
      await expect(page.getByRole("button", { name: "全部已读" })).toBeHidden();
      await page.getByRole("button", { name: "未读" }).click();
      await expect(page.getByText("当前筛选下没有通知。")).toBeVisible();

      await page.goto(`/activities/${activityId}?panel=manage`);
      const management = page.getByRole("dialog", { name: "活动管理" });
      await management.getByRole("button", { name: "编辑转让所有权" }).click();
      const ownership = page.getByRole("dialog", { name: "转让所有权" });
      await ownership.getByLabel("新所有者").selectOption({ label: member.displayName });
      await expect(ownership).toContainText("你会变为普通成员");
      await ownership.getByRole("button", { name: "确认转让" }).click();
      await expect(ownership).toBeHidden();

      await member.page.goto("/notifications");
      await expect(member.page.getByText("你已成为活动所有者")).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await assertNoHorizontalOverflow(member.page);
      await saveChromiumSuccessScreenshot(member.page, testInfo);
    } finally {
      await applicant.context.close();
    }
  } finally {
    await member.context.close();
  }
});
