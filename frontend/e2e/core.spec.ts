import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { assertNoHorizontalOverflow, createActivity, credentials, login, saveChromiumSuccessScreenshot } from "./support/product";

async function addGuest(page: Page, displayName: string): Promise<void> {
  await page.getByRole("link", { name: /成员 \d+/ }).click();
  const dialog = page.getByRole("dialog", { name: "成员" });
  await dialog.getByLabel("临时成员名称").fill(displayName);
  await dialog.getByRole("button", { name: "添加" }).click();
  await expect(dialog.getByText(displayName, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭成员" }).click();
}

async function openQuickExpense(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "快速记账" }).click();
  return page.getByRole("dialog", { name: "记一笔消费" });
}

async function createEqualExpense(page: Page, title: string): Promise<void> {
  const dialog = await openQuickExpense(page);
  await dialog.locator(".amount-input input").fill("100");
  await dialog.getByLabel("标题").fill(title);
  await dialog.getByRole("button", { name: "保存账单", exact: true }).click();
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
}

async function createForeignExpense(page: Page, title: string, ownerName: string, guestName: string): Promise<void> {
  const dialog = await openQuickExpense(page);
  await dialog.locator(".amount-input input").fill("100");
  await dialog.getByLabel("币种").fill("USD");
  await dialog.getByLabel(/汇率/).fill("7");
  await dialog.getByLabel("标题").fill(title);
  await dialog.getByLabel(`${ownerName}支付金额`).fill("60");
  await dialog.getByLabel(`${guestName}支付金额`).fill("40");
  await dialog.getByRole("button", { name: "按金额" }).click();
  await dialog.getByLabel(`${ownerName}按金额`).fill("30");
  await dialog.getByLabel(`${guestName}按金额`).fill("70");
  await dialog.getByRole("button", { name: "保存账单", exact: true }).click();
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expect(page.getByLabel("消费摘要")).toContainText("US$100.00");
}

async function recordSettlement(page: Page, amount: string): Promise<void> {
  await page.locator(".settlement-recommendations button").first().click();
  const dialog = page.getByRole("dialog", { name: "记录结算" });
  await dialog.getByLabel(/金额/).fill(amount);
  await dialog.getByRole("button", { name: "记录结算", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function expenseConflict(context: BrowserContext, expenseUrl: string, firstTitle: string, draftTitle: string): Promise<void> {
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto(expenseUrl), second.goto(expenseUrl)]);
  await Promise.all([
    first.getByLabel("标题").fill(firstTitle),
    second.getByLabel("标题").fill(draftTitle),
  ]);
  await first.getByRole("button", { name: "保存账单" }).click();
  await expect(first.getByRole("link", { name: new RegExp(firstTitle) })).toBeVisible();
  await second.getByRole("button", { name: "保存账单" }).click();
  await expect(second.getByText("当前表单仍保留")).toBeVisible();
  await expect(second.getByLabel("标题")).toHaveValue(draftTitle);
  await Promise.all([first.close(), second.close()]);
}

async function settlementConflict(context: BrowserContext, activityId: string): Promise<void> {
  const first = await context.newPage();
  const second = await context.newPage();
  const url = `/activities/${activityId}?tab=settlement`;
  await Promise.all([first.goto(url), second.goto(url)]);
  const firstRow = first.locator(".settlement-row").first();
  const secondRow = second.locator(".settlement-row").first();
  await Promise.all([
    firstRow.getByRole("button", { name: "修改" }).click(),
    secondRow.getByRole("button", { name: "修改" }).click(),
  ]);
  await firstRow.getByLabel("结算金额").fill("99");
  await secondRow.getByLabel("结算金额").fill("98");
  await firstRow.getByRole("button", { name: "保存" }).click();
  await secondRow.getByRole("button", { name: "保存" }).click();
  await expect(secondRow.getByRole("alert")).toBeVisible();
  await expect(secondRow.getByLabel("结算金额")).toHaveValue("98");
  await Promise.all([first.close(), second.close()]);
}

test("Chromium 核心账务矩阵覆盖冲突、导出、导航与响应式布局", async ({ page, browser }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const activityName = `Phase 1E ${suffix}`;
  const ownerName = credentials().username;
  const guestName = `访客-${suffix}`;
  const equalTitle = `聚餐-${suffix}`;
  const foreignTitle = `酒店-${suffix}`;

  await login(page);
  const mainNavigation = page.getByRole("navigation", { name: "主导航" });
  await expect(mainNavigation.getByRole("link")).toHaveCount(3);
  await assertNoHorizontalOverflow(page);

  const activityId = await createActivity(page, activityName);
  const activityNavigation = page.getByRole("navigation", { name: "活动导航" });
  await expect(activityNavigation.getByRole("link")).toHaveText(["流水", "结算"]);
  await addGuest(page, guestName);
  await createEqualExpense(page, equalTitle);
  await createForeignExpense(page, foreignTitle, ownerName, guestName);
  await assertNoHorizontalOverflow(page);

  const expenseUrl = await page.getByRole("link", { name: new RegExp(equalTitle) }).getAttribute("href");
  expect(expenseUrl).toBeTruthy();
  const storageState = await page.context().storageState();
  const conflictContext = await browser.newContext({ storageState });
  await expenseConflict(conflictContext, expenseUrl!, `${equalTitle}-已保存`, `${equalTitle}-未保存草稿`);

  await page.goto(`/activities/${activityId}?tab=settlement`);
  await expect(page.getByRole("heading", { name: "推荐转账" })).toBeVisible();
  await recordSettlement(page, "100");
  await expect(page.getByRole("heading", { name: "推荐转账" }).locator("..")).toContainText("160.00");
  await recordSettlement(page, "160");
  await expect(page.getByText("全部已结清", { exact: true })).toBeVisible();
  await settlementConflict(conflictContext, activityId);
  await conflictContext.close();

  const summary = await page.request.get(`/api/activities/${activityId}/summary`);
  expect(summary.ok()).toBeTruthy();
  const summaryBody = await summary.json();
  expect(summaryBody.data.activityName).toBe(activityName);
  expect(summaryBody.data.memberCount).toBe(2);
  expect(summaryBody.data.totalExpenseMinor).toBe("80000");
  const csv = await page.request.get(`/api/activities/${activityId}/export.csv`);
  expect(csv.ok()).toBeTruthy();
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const csvText = await csv.text();
  expect(csvText).toContain(equalTitle);
  expect(csvText).toContain(foreignTitle);
  await assertNoHorizontalOverflow(page);
  await page.goto("/activities");
  await saveChromiumSuccessScreenshot(page, testInfo);
});
