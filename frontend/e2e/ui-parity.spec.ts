import { expect, test } from "@playwright/test";

import {
  assertExpenseEditorScrollBoundary,
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

test("活动首页、工作台和记账入口保持远程基线信息路径", async ({ page }, testInfo) => {
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
  // 创建后沿用远程基线的列表→工作台路径，服务端不会自动跳转到新活动。
  const activityLink = page.getByRole("link").filter({ hasText: activityName });
  await expect(activityLink).toBeVisible();
  await activityLink.click();
  await expect(page.getByRole("heading", { name: activityName, exact: true })).toBeVisible();
  const activityHeader = await page.evaluate(() => {
    const back = document.querySelector<HTMLElement>(".workspace-header .back-link")!.getBoundingClientRect();
    const arrow = document.querySelector<SVGElement>(".workspace-header .back-link svg")!.getBoundingClientRect();
    const title = document.querySelector<HTMLElement>(".workspace-header__identity h1")!.getBoundingClientRect();
    return { backLeft: back.left, backWidth: back.width, backHeight: back.height, arrowLeft: arrow.left, titleLeft: title.left };
  });
  expect(activityHeader.backLeft).toBeGreaterThanOrEqual(0);
  expect(activityHeader.backWidth).toBe(44);
  expect(activityHeader.backHeight).toBe(44);
  expect(Math.abs(activityHeader.arrowLeft - activityHeader.titleLeft)).toBeLessThanOrEqual(1);

  const activityNavigation = page.getByRole("navigation", { name: "活动导航" });
  await expect(activityNavigation.getByRole("link")).toHaveText(["流水", "结算"]);
  const expenseDialog = await openQuickExpense(page);
  await expect(expenseDialog.locator(".quick-expense-amount__input")).toBeVisible();
  await expect(expenseDialog.getByLabel("用途")).toBeVisible();
  const saveButton = expenseDialog.getByRole("button", { name: "保存", exact: true });
  await expect(saveButton).toBeVisible();
  await expect(saveButton.locator("..")).toHaveClass(/quick-expense-action-dock/);
  await expect(expenseDialog.getByRole("button", { name: /^付款人：/ })).toBeVisible();
  await expect(expenseDialog.getByRole("button", { name: /^参与人：/ })).toBeVisible();
  await expect(expenseDialog.getByRole("button", { name: "分摊设置：均摊" })).toBeVisible();
  await expect(expenseDialog.getByRole("button", { name: "分类：餐饮" })).toBeVisible();
  await expect(expenseDialog.getByLabel("时间")).toHaveAttribute("type", "datetime-local");
  await expect(expenseDialog.getByRole("button", { name: /^时间：/ })).toHaveCount(0);
  await expect(expenseDialog.getByRole("button", { name: /^备注：/ })).toBeVisible();
  await expect(expenseDialog.getByRole("button", { name: "更多设置", exact: true })).toHaveCount(0);
  await assertQuickExpenseGeometry(page, expenseDialog);
  await assertExpenseEditorScrollBoundary(page, expenseDialog);
  if (testInfo.project.name === "chromium-ui-parity-compact") {
    const defaultOverlayPath = testInfo.outputPath("quick-expense-default.png");
    await page.screenshot({ path: defaultOverlayPath });
    await testInfo.attach("320x568 记一笔默认布局", { path: defaultOverlayPath, contentType: "image/png" });
  }

  await fillQuickExpenseBasics(expenseDialog, "10", "对照路径测试");
  await expenseDialog.getByRole("button", { name: /^付款人：/ }).click();
  const payerDialog = page.getByRole("dialog", { name: "付款人" });
  await assertExpenseEditorScrollBoundary(page, payerDialog);
  await expect(payerDialog.getByRole("button", { name: "单人付款", exact: true })).toBeVisible();
  await payerDialog.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(expenseDialog.getByRole("button", { name: /^付款人：/ })).toBeFocused();

  await expenseDialog.getByRole("button", { name: /^参与人：/ }).click();
  const participantDialog = page.getByRole("dialog", { name: "参与人" });
  await assertExpenseEditorScrollBoundary(page, participantDialog);
  const participantDone = participantDialog.getByRole("button", { name: "完成", exact: true });
  await expect(participantDone).toBeVisible();
  await expect(participantDone.locator("..")).toHaveClass(/quick-expense-action-dock/);
  await participantDialog.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(expenseDialog.getByRole("button", { name: /^参与人：/ })).toBeFocused();

  await expenseDialog.getByRole("button", { name: /^分摊设置：/ }).click();
  const splitDialog = page.getByRole("dialog", { name: "分摊设置" });
  await assertExpenseEditorScrollBoundary(page, splitDialog);
  await expect(splitDialog.getByRole("radio", { name: "均摊", exact: true })).toHaveAttribute("aria-checked", "true");
  await splitDialog.getByRole("radio", { name: "按份数", exact: true }).click();
  const weightInput = splitDialog.getByRole("textbox", { name: /按份数$/ }).first();
  const incrementWeight = splitDialog.getByRole("button", { name: /^增加.+的份数$/ }).first();
  const decrementWeight = splitDialog.getByRole("button", { name: /^减少.+的份数$/ }).first();
  await expect(weightInput).toHaveValue("");
  await expect(decrementWeight).toBeDisabled();
  await incrementWeight.click();
  await expect(weightInput).toHaveValue("1");
  await expect(decrementWeight).toBeDisabled();
  await splitDialog.getByRole("radio", { name: "按比例", exact: true }).click();
  await expect(splitDialog.locator('input[placeholder="%"]')).toHaveCount(1);
  await splitDialog.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(expenseDialog.getByRole("button", { name: /^分摊设置：/ })).toBeFocused();

  await expenseDialog.getByRole("button", { name: /^分类：/ }).click();
  const categoryDialog = page.getByRole("dialog", { name: "分类" });
  await categoryDialog.getByRole("radio", { name: "交通", exact: true }).click();
  await expect(expenseDialog.getByRole("button", { name: "分类：交通" })).toContainText("交通");
  await expect(expenseDialog.getByRole("button", { name: "分类：交通" })).toBeFocused();

  await expenseDialog.getByRole("button", { name: /^币种：/ }).click();
  const currencyDialog = page.getByRole("dialog", { name: "选择币种" });
  await assertExpenseEditorScrollBoundary(page, currencyDialog);
  await currencyDialog.getByPlaceholder("搜索币种").fill("USD");
  await currencyDialog.getByRole("button", { name: /USD/ }).click();
  await expect(page.getByRole("dialog", { name: "设置汇率" })).toBeVisible();
  await expect(expenseDialog.getByRole("textbox", { name: /^汇率（/ })).toBeVisible();
  await expenseDialog.getByRole("textbox", { name: /^汇率（/ }).fill("7.25");
  await expenseDialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(expenseDialog.getByRole("button", { name: "币种：USD" })).toContainText("USD");
  await expect(expenseDialog.getByRole("button", { name: "币种：USD" })).toBeFocused();

  await expenseDialog.getByRole("button", { name: /^备注：/ }).click();
  await expect(page.getByRole("dialog", { name: "备注与附件" })).toBeVisible();
  await expect(expenseDialog.getByLabel("备注", { exact: true })).toBeVisible();
  await expenseDialog.getByRole("button", { name: "完成", exact: true }).click();
  await assertExpenseEditorScrollBoundary(page, expenseDialog);
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

test("通知与我的页覆盖主题、昵称和退出流程", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "通知", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "通知筛选" }).getByRole("button")).toHaveText(["全部", "未读", "邀请", "结算", "系统"]);
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "我的", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "账户与安全", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "主题：跟随系统" }).click();
  const themeSheet = page.getByRole("dialog", { name: "主题" });
  const productNavigation = page.getByRole("navigation", { name: "主导航" });
  await expect(themeSheet.getByRole("radio")).toHaveCount(3);
  await themeSheet.getByRole("radio", { name: "亮色" }).click();
  const lightNavigationBackground = await productNavigation.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await themeSheet.getByRole("radio", { name: "暗色" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("huddletab-theme"))).toBe("dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0d1512");
  await expect.poll(() => productNavigation.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )).not.toBe(lightNavigationBackground);
  await expect.poll(() => productNavigation.evaluate(
    (element) => Math.round(element.getBoundingClientRect().bottom),
  )).toBe(await page.evaluate(() => window.innerHeight));
  await themeSheet.getByRole("button", { name: "关闭主题" }).click();

  const displayName = `昵称-${testInfo.project.name}-${Date.now()}`;
  await page.getByRole("button", { name: "修改昵称" }).click();
  const nicknameSheet = page.getByRole("dialog", { name: "修改昵称" });
  const nicknameInput = nicknameSheet.getByRole("textbox", { name: "昵称" });
  await expect(nicknameInput).toBeFocused();
  await nicknameInput.fill(`  ${displayName}  `);
  const profileResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().endsWith("/api/me/profile"),
  );
  await nicknameInput.press("Enter");
  expect((await profileResponse).status()).toBe(200);
  await expect(nicknameSheet).toHaveCount(0);
  await expect(page.locator(".profile-identity-button strong")).toHaveText(displayName);
  await assertNoHorizontalOverflow(page);

  const logoutResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/auth/logout"),
  );
  await page.getByRole("button", { name: "退出登录" }).click();
  expect((await logoutResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
});

test("Chromium Mobile 首页入口 Sheet 贴底并按历史层级返回", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-ui-parity-mobile", "仅在 390×844 Chromium Mobile 检查首页 Sheet 几何。");

  await login(page);
  await page.goto("/activities");

  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const actionTrigger = page.getByRole("button", { name: "新建或加入活动", exact: true });
  await actionTrigger.click();
  const actionDialog = page.getByRole("dialog", { name: "新建或加入活动" });
  await expect(actionDialog).toBeVisible();
  await expect.poll(() => actionDialog.evaluate((element) => Math.round(element.getBoundingClientRect().bottom))).toBe(viewport.height);
  const actionGeometry = await actionDialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const firstAction = element.querySelector<HTMLElement>(".settings-row");
    const title = firstAction?.querySelector("strong")?.getBoundingClientRect();
    const description = firstAction?.querySelector("small")?.getBoundingClientRect();
    return { left: Math.round(box.left), width: Math.round(box.width), titleBottom: title?.bottom ?? null, descriptionTop: description?.top ?? null };
  });
  expect(actionGeometry.left).toBe(0);
  expect(actionGeometry.width).toBe(viewport.width);
  expect(actionGeometry.titleBottom).not.toBeNull();
  expect(actionGeometry.descriptionTop).toBeGreaterThanOrEqual(actionGeometry.titleBottom!);
  await assertNoHorizontalOverflow(page);

  await actionDialog.getByRole("button", { name: /^创建活动/ }).click();
  await expect(page).toHaveURL(/\/activities\?panel=create$/);
  await expect(page.getByLabel("活动名称")).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/activities\?panel=actions$/);
  await expect(page.getByRole("dialog", { name: "新建或加入活动" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "已删除活动", exact: true }).click();
  const deletedDialog = page.getByRole("dialog", { name: "已删除活动" });
  await expect(deletedDialog).toBeVisible();
  await expect.poll(() => deletedDialog.evaluate((element) => Math.round(element.getBoundingClientRect().bottom))).toBe(viewport.height);
  expect(await deletedDialog.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(viewport.width);
  await expect(deletedDialog.getByText("当前没有可恢复的活动。", { exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await deletedDialog.getByRole("button", { name: "关闭已删除活动", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
