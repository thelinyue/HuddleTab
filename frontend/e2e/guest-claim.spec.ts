import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type TestInfo } from "@playwright/test";
import { assertNoHorizontalOverflow, createActivity, installArtifactVisualRedaction, login } from "./support/product";

/** 夹具通过真实 API 准备账务；认领、注册和审批由用户界面完成。 */
async function mutate(page: Page, method: string, path: string, data: unknown) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const response = await page.request.fetch(path, {
    method, data, headers: { "X-CSRF-Token": csrf.data.token, Origin: new URL(page.url()).origin },
  });
  expect(response.ok(), `准备认领场景失败（HTTP ${response.status()}）`).toBe(true);
  return (await response.json()).data;
}

async function registerForInvitation(browser: Browser, testInfo: TestInfo, token: string) {
  const context = await browser.newContext(testInfo.project.use as BrowserContextOptions);
  await installArtifactVisualRedaction(context);
  const page = await context.newPage();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const displayName = `认领用户-${suffix}`;
  const password = `${crypto.randomUUID()}Aa1!`;
  let joinCalls = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith(`/invitations/${token}/join`)) joinCalls += 1; });
  const openInvitation = async () => {
    const previewResponse = page.waitForResponse((item) => item.request().method() === "GET" && item.url().endsWith(`/api/invitations/${token}`));
    await page.goto(`/join/${token}`);
    return previewResponse;
  };
  let previewResponse = await openInvitation();
  if (previewResponse.status() === 429) {
    // 四个视口共享真实邀请限流桶，按服务端窗口等待，不放宽生产配额。
    const retryAfter = Number(previewResponse.headers()["retry-after"] ?? "60");
    await page.waitForTimeout(Math.min(60, Math.max(1, retryAfter)) * 1000 + 500);
    previewResponse = await openInvitation();
  }
  expect(previewResponse.ok(), `读取邀请失败（HTTP ${previewResponse.status()}）`).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.getByRole("radio").count()).toBe(0);
  await page.getByRole("link", { name: "注册后加入", exact: true }).click();
  await page.getByLabel("昵称").fill(displayName);
  await page.getByLabel("用户名").fill(`claim${suffix}`);
  await page.locator("#register-password").fill(password);
  await page.locator("#register-confirm-password").fill(password);
  const submit = async () => {
    const response = page.waitForResponse((item) => item.request().method() === "POST" && item.url().endsWith("/api/auth/register"));
    await page.getByRole("button", { name: "注册", exact: true }).click();
    return response;
  };
  let response = await submit();
  if (response.status() === 429) {
    const retryAfter = Number(response.headers()["retry-after"] ?? "60");
    await page.waitForTimeout(Math.min(60, Math.max(1, retryAfter)) * 1000);
    response = await submit();
  }
  expect(response.ok(), `受邀注册失败（HTTP ${response.status()}）`).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/join/${token}$`));
  await expect(page.getByRole("button", { name: "加入活动", exact: true })).toBeEnabled();
  expect(joinCalls).toBe(0);
  return { context, page, displayName, joinCalls: () => joinCalls };
}

test("受邀注册后认领原身份，直接加入和审批都保留历史账目", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const contexts: BrowserContext[] = [];
  await login(page);
  const activityName = `成员认领-${testInfo.project.name}-${Date.now()}`;
  const activityId = await createActivity(page, activityName);
  const guestName = `历史临时成员${"长昵称".repeat(15)}`;
  const guest = await mutate(page, "POST", `/api/activities/${activityId}/members/guests`, { displayName: guestName });
  const invitation = await mutate(page, "POST", `/api/activities/${activityId}/invitations`, { kind: "LINK" });
  const expenseTitle = "认领前的历史账单";
  await mutate(page, "POST", `/api/activities/${activityId}/expenses`, {
    clientMutationId: crypto.randomUUID(), title: expenseTitle, category: "OTHER", occurredAt: new Date().toISOString(),
    originalCurrency: "CNY", originalAmountMinor: "10000", exchangeRateKind: "IDENTITY", exchangeRate: "1",
    payments: [{ memberId: guest.memberId, amountMinor: "10000" }], split: { mode: "EQUAL", members: [guest.memberId] },
  });
  try {
    const direct = await registerForInvitation(browser, testInfo, invitation.token);
    contexts.push(direct.context);
    await expect(direct.page.getByRole("radio", { name: "作为新成员加入" })).toBeChecked();
    // 原生单选组支持键盘方向键；最长昵称在手机上换行，不扩大页面宽度。
    await direct.page.getByRole("radio", { name: "作为新成员加入" }).focus();
    await direct.page.keyboard.press("ArrowDown");
    await expect(direct.page.getByRole("radio", { name: `认领「${guestName}」`, exact: true })).toBeChecked();
    await expect(direct.page.getByText("认领后将承接该成员的历史账目。")).toBeVisible();
    await assertNoHorizontalOverflow(direct.page);
    await direct.page.screenshot({ path: testInfo.outputPath("join-identity.png"), fullPage: true });
    await direct.page.getByRole("button", { name: "认领并加入", exact: true }).click();
    await expect(direct.page).toHaveURL(new RegExp(`/activities/${activityId}$`));
    await expect(direct.page.getByRole("link", { name: new RegExp(expenseTitle) })).toBeVisible();
    expect(direct.joinCalls()).toBe(1);
    const directActivity = await (await direct.page.request.get(`/api/activities/${activityId}`)).json();
    expect(directActivity.data.currentMemberId).toBe(guest.memberId);
    const members = await (await page.request.get(`/api/activities/${activityId}/members`)).json();
    expect(members.data).toHaveLength(2);
    expect(members.data.find((member: { memberId: string }) => member.memberId === guest.memberId).displayName).toBe(guestName);

    const approvalName = "待审批的临时成员";
    const approvalGuest = await mutate(page, "POST", `/api/activities/${activityId}/members/guests`, { displayName: approvalName });
    const activity = await (await page.request.get(`/api/activities/${activityId}`)).json();
    await mutate(page, "PUT", `/api/activities/${activityId}`, { version: activity.data.version, inviteMode: "REQUIRE_APPROVAL" });
    const applicant = await registerForInvitation(browser, testInfo, invitation.token);
    contexts.push(applicant.context);
    await applicant.page.getByRole("radio", { name: `认领「${approvalName}」`, exact: true }).check();
    await applicant.page.getByRole("button", { name: "申请认领", exact: true }).click();
    await expect(applicant.page.getByText("等待活动所有者审批", { exact: true })).toBeVisible();
    await expect(applicant.page.getByText(`申请认领「${approvalName}」`, { exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(applicant.page);
    await page.reload();
    await page.getByRole("link", { name: /成员 \d+/ }).click();
    const memberPanel = page.getByRole("dialog", { name: "成员", exact: true });
    await expect(memberPanel.getByText(`申请认领「${approvalName}」`, { exact: true })).toBeVisible();
    await memberPanel.getByRole("button", { name: `批准${applicant.displayName}`, exact: true }).click();
    await expect(memberPanel.getByRole("button", { name: `批准${applicant.displayName}`, exact: true })).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    await applicant.page.reload();
    await expect(applicant.page.getByText("认领申请已批准", { exact: true })).toBeVisible();
    await applicant.page.getByRole("link", { name: "打开活动", exact: true }).click();
    await expect(applicant.page.getByRole("heading", { name: activityName, exact: true })).toBeVisible();
    const approvedActivity = await (await applicant.page.request.get(`/api/activities/${activityId}`)).json();
    expect(approvedActivity.data.currentMemberId).toBe(approvalGuest.memberId);
    await assertNoHorizontalOverflow(applicant.page);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
