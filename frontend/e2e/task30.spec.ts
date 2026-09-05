import { expect, test } from "@playwright/test";
import { assertNoHorizontalOverflow, createActivity, fillQuickExpenseBasics, installArtifactVisualRedaction, login, openQuickExpense, saveChromiumSuccessScreenshot } from "./support/product";

test("Task 30 初始化、摘要复制分享、PNG 与 CSV 保持 v0.0.2 交互密度", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await installArtifactVisualRedaction(page.context());
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login$/);
  await login(page);

  const activityName = `Task30 ${testInfo.project.name}-${Date.now()}`;
  const activityId = await createActivity(page, activityName);
  const dialog = await openQuickExpense(page);
  await fillQuickExpenseBasics(dialog, "42", "Task30 测试餐费");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("link", { name: /Task30 测试餐费/ })).toBeVisible();

  await page.goto(`/share-summary/${activityId}`);
  await expect(page.getByRole("heading", { name: "结算分享摘要" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "活动概览" })).toBeVisible();
  await expect(page.getByText(/1 笔账单/)).toBeVisible();
  expect(await page.getByText("¥42.00").count()).toBeGreaterThanOrEqual(2);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => undefined } });
  });
  await page.getByRole("button", { name: "复制摘要" }).click();
  await expect(page.getByRole("status")).toHaveText("摘要已复制。");
  await page.getByRole("button", { name: "系统分享" }).click();
  await expect(page.getByRole("status")).toHaveText("摘要已复制。");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PNG" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("huddletab-settlement-summary.png");

  const summary = await page.request.get(`/api/activities/${activityId}/summary`);
  expect(summary.ok()).toBeTruthy();
  const summaryBody = await summary.json();
  expect(summaryBody.data.activityName).toBe(activityName);
  expect(summaryBody.data.expenseCount).toBe(1);
  expect(summaryBody.data.averageExpenseMinor).toBe("4200");
  const csv = await page.request.get(`/api/activities/${activityId}/export.csv`);
  expect(csv.ok()).toBeTruthy();
  expect(csv.headers()["content-disposition"]).toContain("activity-export.csv");
  expect(await csv.text()).toContain("Task30 测试餐费");

  await assertNoHorizontalOverflow(page);
  await page.goto(`/activities/${activityId}`);
  await expect(page.getByRole("navigation", { name: "活动导航" }).getByRole("link")).toHaveText(["流水", "结算"]);
  await saveChromiumSuccessScreenshot(page, testInfo);
});
