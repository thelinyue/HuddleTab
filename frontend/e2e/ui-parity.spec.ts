import { expect, test } from "@playwright/test";

import {
  assertNoHorizontalOverflow,
  login,
  saveChromiumSuccessScreenshot,
} from "./support/product";

/** UI 对照只检查稳定的信息架构和可完成交互，不建立像素 hash 或视觉冻结门槛。 */
async function openCreateActivity(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "新建或加入活动", exact: true }).click();
  const actionDialog = page.getByRole("dialog", { name: "新建或加入活动" });
  await expect(actionDialog.getByText("创建活动", { exact: true })).toBeVisible();
  await actionDialog.getByRole("button", { name: /^创建活动/ }).click();
  return page.getByRole("dialog", { name: "创建活动" });
}

test("v0.0.2 活动首页、工作台和记账入口保持同一信息路径", async ({ page }, testInfo) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "活动", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link")).toHaveText(["活动", "通知", "我的"]);

  const actionButton = page.getByRole("button", { name: "新建或加入活动" });
  await actionButton.click();
  const actionDialog = page.getByRole("dialog", { name: "新建或加入活动" });
  await expect(actionDialog.getByRole("button", { name: /^创建活动/ })).toBeVisible();
  await expect(actionDialog.getByRole("button", { name: /^加入活动/ })).toBeVisible();
  await actionDialog.getByRole("button", { name: `关闭新建或加入活动` }).click();
  await expect(actionDialog).toHaveCount(0);

  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const activityName = `UI 对照 ${suffix}`;
  const createDialog = await openCreateActivity(page);
  await createDialog.getByLabel("活动名称").fill(activityName);
  await createDialog.getByRole("button", { name: "创建活动", exact: true }).click();
  // 创建后沿用 v0.0.2 的列表→工作台路径，服务端不会自动跳转到新活动。
  const activityLink = page.getByRole("link").filter({ hasText: activityName });
  await expect(activityLink).toBeVisible();
  await activityLink.click();
  await expect(page.getByRole("heading", { name: activityName, exact: true })).toBeVisible();

  const activityNavigation = page.getByRole("navigation", { name: "活动导航" });
  await expect(activityNavigation.getByRole("link")).toHaveText(["流水", "结算"]);
  await page.getByRole("button", { name: "快速记账" }).click();
  const expenseDialog = page.getByRole("dialog", { name: "记一笔消费" });
  await expect(expenseDialog.locator(".amount-input input")).toBeVisible();
  await expect(expenseDialog.getByLabel("标题")).toBeVisible();
  await expect(expenseDialog.getByRole("button", { name: "保存账单", exact: true })).toBeVisible();
  await expenseDialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(expenseDialog).toHaveCount(0);
  await assertNoHorizontalOverflow(page);
  await saveChromiumSuccessScreenshot(page, testInfo);
});

test("通知、我的和管理入口沿用 v0.0.2 的紧凑分组层级", async ({ page }) => {
  await login(page);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "通知", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "通知筛选" }).getByRole("button")).toHaveText(["全部", "未读", "邀请", "结算", "系统"]);
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "我的", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "账户与安全", exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});
