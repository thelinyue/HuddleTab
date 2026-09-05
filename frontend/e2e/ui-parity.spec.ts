import { expect, test } from "@playwright/test";

import {
  assertNoHorizontalOverflow,
  assertQuickExpenseGeometry,
  fillQuickExpenseBasics,
  login,
  openQuickExpense,
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
  const expenseDialog = await openQuickExpense(page);
  await expect(expenseDialog.locator(".quick-expense-amount__input")).toBeVisible();
  await expect(expenseDialog.getByLabel("用途")).toBeVisible();
  await expect(expenseDialog.getByRole("button", { name: "保存", exact: true })).toBeVisible();
  await expect(expenseDialog.getByRole("button", { name: "谁付款", exact: true })).toBeVisible();
  await expect(expenseDialog.getByRole("button", { name: "谁参与", exact: true })).toBeVisible();
  await expect(expenseDialog.getByRole("button", { name: "分摊设置", exact: true })).toBeVisible();
  await expect(expenseDialog.getByRole("button", { name: "分类", exact: true })).toBeVisible();
  await assertQuickExpenseGeometry(page, expenseDialog);

  await fillQuickExpenseBasics(expenseDialog, "10", "对照路径测试");
  await expenseDialog.getByRole("button", { name: "谁付款", exact: true }).click();
  const payerDialog = page.getByRole("dialog", { name: "谁付款" });
  await expect(payerDialog.getByRole("button", { name: "单人付款", exact: true })).toBeVisible();
  await payerDialog.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(expenseDialog.getByRole("button", { name: "谁付款", exact: true })).toBeFocused();

  await expenseDialog.getByRole("button", { name: "谁参与", exact: true }).click();
  const participantDialog = page.getByRole("dialog", { name: "谁参与" });
  await expect(participantDialog.getByRole("button", { name: "完成", exact: true })).toBeVisible();
  await participantDialog.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(expenseDialog.getByRole("button", { name: "谁参与", exact: true })).toBeFocused();

  await expenseDialog.getByRole("button", { name: "分摊设置", exact: true }).click();
  const splitDialog = page.getByRole("dialog", { name: "分摊设置" });
  await expect(splitDialog.getByRole("radio", { name: "均摊", exact: true })).toHaveAttribute("aria-checked", "true");
  await splitDialog.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(expenseDialog.getByRole("button", { name: "分摊设置", exact: true })).toBeFocused();

  await expenseDialog.getByRole("button", { name: "分类", exact: true }).click();
  const categoryDialog = page.getByRole("dialog", { name: "分类" });
  await categoryDialog.getByRole("radio", { name: "交通", exact: true }).click();
  await expect(expenseDialog.getByRole("button", { name: "分类", exact: true })).toContainText("交通");
  await expect(expenseDialog.getByRole("button", { name: "分类", exact: true })).toBeFocused();

  await expenseDialog.getByRole("button", { name: "币种", exact: true }).click();
  const currencyDialog = page.getByRole("dialog", { name: "选择币种" });
  await currencyDialog.getByPlaceholder("搜索币种").fill("USD");
  await currencyDialog.getByRole("button", { name: /USD/ }).click();
  await expect(expenseDialog.getByRole("button", { name: "币种", exact: true })).toContainText("USD");
  await expect(expenseDialog.getByRole("button", { name: "币种", exact: true })).toBeFocused();

  const moreSettings = expenseDialog.getByRole("button", { name: "更多设置", exact: true });
  await moreSettings.click();
  await expect(moreSettings).toHaveAttribute("aria-expanded", "true");
  await expect(expenseDialog.getByLabel(/汇率/)).toBeVisible();
  await assertNoHorizontalOverflow(page);
  const overlayPath = testInfo.outputPath("quick-expense-overlay.png");
  await page.screenshot({ path: overlayPath });
  await testInfo.attach("记一笔完整信息路径", { path: overlayPath, contentType: "image/png" });

  await expenseDialog.getByRole("button", { name: "关闭记一笔", exact: true }).click();
  await expect(expenseDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "记一笔", exact: true })).toBeFocused();
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
