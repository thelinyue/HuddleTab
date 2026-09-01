import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page, type TestInfo } from "@playwright/test";
import { assertCredentialFieldsVisuallyMasked, assertNoHorizontalOverflow, createActivity, installArtifactVisualRedaction, login, saveChromiumSuccessScreenshot } from "./support/product";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

async function createConflictPages(browser: Browser, testInfo: TestInfo, storageState: StorageState): Promise<{ first: Page; second: Page; close: () => Promise<void> }> {
  const contextOptions = { ...testInfo.project.use, storageState } as BrowserContextOptions;
  const firstContext = await browser.newContext(contextOptions);
  const secondContext = await browser.newContext(contextOptions);
  await Promise.all([installArtifactVisualRedaction(firstContext), installArtifactVisualRedaction(secondContext)]);
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  return {
    first,
    second,
    close: async () => { await Promise.all([firstContext.close(), secondContext.close()]); },
  };
}

async function assertProjectViewport(first: Page, second: Page, testInfo: TestInfo): Promise<void> {
  const viewport = testInfo.project.use.viewport;
  if (!viewport) return;
  await Promise.all([
    expect.poll(() => first.evaluate(() => window.innerWidth)).toBe(viewport.width),
    expect.poll(() => second.evaluate(() => window.innerWidth)).toBe(viewport.width),
  ]);
}

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

async function createForeignExpense(page: Page, title: string): Promise<void> {
  const dialog = await openQuickExpense(page);
  await dialog.locator(".amount-input input").fill("100");
  await dialog.getByLabel("币种").fill("USD");
  await dialog.getByLabel(/汇率/).fill("7");
  await dialog.getByLabel("标题").fill(title);
  const memberInputs = dialog.locator(".member-input-list");
  const paymentInputs = memberInputs.nth(0).locator('input[inputmode="decimal"]');
  await paymentInputs.nth(0).fill("60");
  await paymentInputs.nth(1).fill("40");
  await dialog.getByRole("button", { name: "按金额" }).click();
  const splitInputs = memberInputs.nth(1).locator('input[inputmode="decimal"]');
  await splitInputs.nth(0).fill("30");
  await splitInputs.nth(1).fill("70");
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

async function expenseConflict(browser: Browser, testInfo: TestInfo, storageState: StorageState, expenseUrl: string, originalTitle: string, firstTitle: string, draftTitle: string): Promise<void> {
  const pages = await createConflictPages(browser, testInfo, storageState);
  try {
    await Promise.all([pages.first.goto(expenseUrl), pages.second.goto(expenseUrl)]);
    await assertProjectViewport(pages.first, pages.second, testInfo);
    await Promise.all([
      expect(pages.first.getByLabel("标题")).toHaveValue(originalTitle),
      expect(pages.second.getByLabel("标题")).toHaveValue(originalTitle),
    ]);
    await Promise.all([
      pages.first.getByLabel("标题").fill(firstTitle),
      pages.second.getByLabel("标题").fill(draftTitle),
    ]);
    await pages.first.getByRole("button", { name: "保存账单" }).click();
    await expect(pages.first.getByRole("link", { name: new RegExp(firstTitle) })).toBeVisible();
    const conflictResponsePromise = pages.second.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes("/expenses/"));
    await pages.second.getByRole("button", { name: "保存账单" }).click();
    const conflictResponse = await conflictResponsePromise;
    expect(conflictResponse.status()).toBe(409);
    await expect(pages.second.getByText("当前表单仍保留")).toBeVisible();
    await expect(pages.second.getByLabel("标题")).toHaveValue(draftTitle);
  } finally {
    await pages.close();
  }
}

async function settlementConflict(browser: Browser, testInfo: TestInfo, storageState: StorageState, activityId: string): Promise<void> {
  const pages = await createConflictPages(browser, testInfo, storageState);
  try {
    const url = `/activities/${activityId}?tab=settlement`;
    await Promise.all([pages.first.goto(url), pages.second.goto(url)]);
    await assertProjectViewport(pages.first, pages.second, testInfo);
    const firstRow = pages.first.locator(".settlement-row").first();
    const secondRow = pages.second.locator(".settlement-row").first();
    await Promise.all([
      firstRow.getByRole("button", { name: "修改" }).click(),
      secondRow.getByRole("button", { name: "修改" }).click(),
    ]);
    const firstAmount = firstRow.getByLabel("结算金额");
    const secondAmount = secondRow.getByLabel("结算金额");
    expect(await secondAmount.inputValue()).toBe(await firstAmount.inputValue());
    await firstAmount.fill("99");
    await secondAmount.fill("98");
    await firstRow.getByRole("button", { name: "保存" }).click();
    const conflictResponsePromise = pages.second.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes("/settlements/"));
    await secondRow.getByRole("button", { name: "保存" }).click();
    const conflictResponse = await conflictResponsePromise;
    expect(conflictResponse.status()).toBe(409);
    await expect(secondRow.getByRole("alert")).toBeVisible();
    await expect(secondAmount).toHaveValue("98");
  } finally {
    await pages.close();
  }
}

test("Chromium 核心账务矩阵覆盖冲突、导出、导航与响应式布局", async ({ page, browser }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const activityName = `Phase 1E ${suffix}`;
  const guestName = `访客-${suffix}`;
  const equalTitle = `聚餐-${suffix}`;
  const foreignTitle = `酒店-${suffix}`;

  await assertCredentialFieldsVisuallyMasked(page);
  await login(page);
  const mainNavigation = page.getByRole("navigation", { name: "主导航" });
  await expect(mainNavigation.getByRole("link")).toHaveCount(3);
  await assertNoHorizontalOverflow(page);

  const activityId = await createActivity(page, activityName);
  const activityNavigation = page.getByRole("navigation", { name: "活动导航" });
  await expect(activityNavigation.getByRole("link")).toHaveText(["流水", "结算"]);
  await addGuest(page, guestName);
  await createEqualExpense(page, equalTitle);
  await createForeignExpense(page, foreignTitle);
  await assertNoHorizontalOverflow(page);

  const expenseUrl = await page.getByRole("link", { name: new RegExp(equalTitle) }).getAttribute("href");
  expect(expenseUrl).toBeTruthy();
  const storageState = await page.context().storageState();
  await expenseConflict(browser, testInfo, storageState, expenseUrl!, equalTitle, `${equalTitle}-已保存`, `${equalTitle}-未保存草稿`);

  await page.goto(`/activities/${activityId}?tab=settlement`);
  await expect(page.getByRole("heading", { name: "推荐转账" })).toBeVisible();
  await recordSettlement(page, "100");
  await expect(page.getByRole("heading", { name: "推荐转账" }).locator("..")).toContainText("160.00");
  await recordSettlement(page, "160");
  await expect(page.getByText("全部已结清", { exact: true })).toBeVisible();
  await settlementConflict(browser, testInfo, storageState, activityId);

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
