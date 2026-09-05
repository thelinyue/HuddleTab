import { expect, test, type Page } from "@playwright/test";
import { assertNoHorizontalOverflow, createActivity, credentials, fillQuickExpenseBasics, installArtifactVisualRedaction, login, openQuickExpense, saveChromiumSuccessScreenshot } from "./support/product";

async function waitForSnapshotCache(page: Page, activityId: string): Promise<void> {
  await expect.poll(() => page.evaluate(async (targetActivityId) => {
    const raw = sessionStorage.getItem("huddletab:offline-session");
    if (!raw) return false;
    const userId = (JSON.parse(raw) as { userId?: string }).userId;
    if (!userId) return false;
    return await new Promise<boolean>((resolve) => {
      const request = indexedDB.open(`huddletab:${userId}`);
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction("activity_snapshots", "readonly")
          .objectStore("activity_snapshots").get(targetActivityId);
        read.onsuccess = () => {
          resolve(Boolean(read.result));
          database.close();
        };
        read.onerror = () => {
          resolve(false);
          database.close();
        };
      };
    });
  }, activityId)).toBe(true);
}

async function createExpense(page: Page, title: string, expectedStatus: string): Promise<void> {
  const dialog = await openQuickExpense(page);
  await fillQuickExpenseBasics(dialog, "12.34", title);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".expense-row--pending").filter({ hasText: title })).toContainText(expectedStatus);
}

async function loginAfterRateLimit(page: Page): Promise<void> {
  try {
    await login(page);
    return;
  } catch (cause) {
    const message = await page.getByRole("alert").textContent().catch(() => "");
    if (!message?.includes("请求过于频繁")) throw cause;
    // 认证桶是生产安全边界；总入口的多个浏览器项目共用本机 peer IP，等待一个窗口再重试。
    await page.waitForTimeout(61_000);
    const { username, password } = credentials();
    await installArtifactVisualRedaction(page.context());
    await page.goto("/login");
    await page.getByLabel("用户名").fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByRole("heading", { name: "活动", exact: true })).toBeVisible();
  }
}

test("Phase 2 离线工作台、幂等重放、REJECTED 修正与 Snapshot 条件读取", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  await loginAfterRateLimit(page);
  const activityId = await createActivity(page, `Phase 1E Phase 2 ${testInfo.project.name}-${Date.now()}`);
  await expect(page.getByRole("navigation", { name: "活动导航" }).getByRole("link")).toHaveText(["流水", "结算"]);

  // 首次在线加载必须落下完整 Snapshot，之后断网只允许使用当前用户缓存。
  await waitForSnapshotCache(page, activityId);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller))).toBe(true);
  const snapshot = await page.request.get(`/api/activities/${activityId}/snapshot`);
  expect(snapshot.status()).toBe(200);
  const etag = snapshot.headers().etag;
  expect(etag).toMatch(/^W\/"\d+"$/);
  const notModified = await page.request.get(`/api/activities/${activityId}/snapshot`, {
    headers: { "If-None-Match": etag },
  });
  expect(notModified.status()).toBe(304);
  expect(await notModified.text()).toBe("");

  const offlineTitle = `断网早餐-${Date.now()}`;
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await createExpense(page, offlineTitle, "等待同步");
  await page.reload();
  await expect(page.getByText(/当前离线/)).toBeVisible();
  await expect(page.locator(".expense-row--pending").filter({ hasText: offlineTitle })).toContainText("等待同步");
  await expect(page.getByRole("link", { name: /成员 \d+/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "活动管理" })).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("link", { name: new RegExp(offlineTitle) })).toBeVisible({ timeout: 20_000 });

  // 服务端已提交但客户端丢响应时，队列重放同一个 clientMutationId，最终只有一笔事实。
  const lostResponseTitle = `丢响应早餐-${Date.now()}`;
  const sentMutationIds: string[] = [];
  let loseResponse = true;
  await page.route("**/api/activities/*/expenses", async (route) => {
    if (route.request().method() !== "POST" || !loseResponse) {
      await route.continue();
      return;
    }
    loseResponse = false;
    const requestBody = route.request().postDataJSON() as { clientMutationId?: string };
    if (requestBody.clientMutationId) sentMutationIds.push(requestBody.clientMutationId);
    const response = await route.fetch();
    if (response.status() >= 200 && response.status() < 300) {
      const body = await response.body();
      void body;
    }
    await route.abort();
  });
  await createExpense(page, lostResponseTitle, "同步失败，将稍后重试");
  await page.unroute("**/api/activities/*/expenses");
  await expect(page.getByRole("link", { name: new RegExp(lostResponseTitle) })).toBeVisible({ timeout: 20_000 });
  expect(sentMutationIds).toHaveLength(1);
  const expensesAfterReplay = await (await page.request.get(`/api/activities/${activityId}/expenses`)).json();
  expect(expensesAfterReplay.data.filter((item: { expense: { title: string } }) => item.expense.title === lostResponseTitle)).toHaveLength(1);

  // 业务 422 进入 REJECTED；修正后沿用本地记录和 mutation id 再次发送。
  const rejectedTitle = `需要修正早餐-${Date.now()}`;
  let rejectOnce = true;
  await page.route("**/api/activities/*/expenses", async (route) => {
    if (route.request().method() === "POST" && rejectOnce) {
      rejectOnce = false;
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: {
          code: "INVALID_EXPENSE",
          details: {},
          fieldErrors: {},
          message: "账单输入不正确。",
          requestId: "phase2-rejected",
        } }),
      });
      return;
    }
    await route.continue();
  });
  await createExpense(page, rejectedTitle, "需要修改");
  await expect(page.locator(".expense-row--pending").filter({ hasText: rejectedTitle })).toContainText("需要修改");
  await page.unroute("**/api/activities/*/expenses");
  const rejectedRow = page.locator(".expense-row--pending").filter({ hasText: rejectedTitle });
  await rejectedRow.getByRole("button", { name: "修改后重试" }).click();
  const rejectedDialog = page.getByRole("dialog", { name: "修改被拒账单" });
  const correctedTitle = `${rejectedTitle}-已修正`;
  await rejectedDialog.getByLabel("标题").fill(correctedTitle);
  await rejectedDialog.getByRole("button", { name: "修改后重试" }).click();
  await expect(page.getByRole("link", { name: new RegExp(correctedTitle) })).toBeVisible({ timeout: 20_000 });
  const expensesAfterCorrection = await (await page.request.get(`/api/activities/${activityId}/expenses`)).json();
  expect(expensesAfterCorrection.data.filter((item: { expense: { title: string } }) => item.expense.title === correctedTitle)).toHaveLength(1);
  expect(expensesAfterCorrection.data.filter((item: { expense: { title: string } }) => item.expense.title === rejectedTitle)).toHaveLength(0);

  await assertNoHorizontalOverflow(page);
  await saveChromiumSuccessScreenshot(page, testInfo);
});
