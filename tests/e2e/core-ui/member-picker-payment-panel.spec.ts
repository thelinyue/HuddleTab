import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  createActivityThroughUi,
  signInThroughUi,
  uniqueScenarioSuffix,
} from "./authenticated-product-support";

test.skip(
  process.env.RUN_AUTHENTICATED_PRODUCT_E2E !== "true",
  "仅对保留数据的外部生产容器执行成员选择器验收。",
);

async function expectTouchTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label}没有可测量的触控区域`).not.toBeNull();
  expect(box!.width, `${label}的触控宽度不足 44px`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${label}的触控高度不足 44px`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ),
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

async function openExpenseForm(
  page: Page,
  activityId: string,
  viewport: { readonly width: number; readonly height: number },
  theme: "light" | "dark",
) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.goto(`/activities/${activityId}`);
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(new RegExp(theme));
  await page.getByRole("button", { name: "记一笔" }).click();
  await expect(page.getByRole("heading", { name: "记一笔" })).toBeVisible();
}

async function expectAmountCentered(page: Page) {
  const dialog = page.getByRole("dialog", { name: "记一笔" });
  const row = page.locator("[data-quick-expense-amount-row]");
  const amount = page.getByLabel("金额", { exact: true });
  const currency = page.getByRole("button", { name: "币种" });
  const [dialogBox, rowBox, amountBox, currencyBox] = await Promise.all([
    dialog.boundingBox(),
    row.boundingBox(),
    amount.boundingBox(),
    currency.boundingBox(),
  ]);

  await expect(amount).toBeFocused();
  expect(dialogBox, "记一笔 Overlay 没有可测量边界").not.toBeNull();
  expect(rowBox, "金额行没有可测量边界").not.toBeNull();
  expect(amountBox, "金额输入框没有可测量边界").not.toBeNull();
  expect(currencyBox, "币种入口没有可测量边界").not.toBeNull();
  const dialogCenter = dialogBox!.x + dialogBox!.width / 2;
  const amountCenter = amountBox!.x + amountBox!.width / 2;
  expect(
    Math.abs(amountCenter - dialogCenter),
    "金额输入框中心偏离 Sheet 中轴",
  ).toBeLessThanOrEqual(2);
  const overlaps =
    currencyBox!.x < amountBox!.x + amountBox!.width &&
    currencyBox!.x + currencyBox!.width > amountBox!.x &&
    currencyBox!.y < amountBox!.y + amountBox!.height &&
    currencyBox!.y + currencyBox!.height > amountBox!.y;
  expect(overlaps, "币种入口与金额输入框重叠").toBe(false);
  expect(rowBox!.width, "金额行宽度超出 Overlay").toBeLessThanOrEqual(
    dialogBox!.width,
  );
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ),
  }));
  expect(widths.scroll, "页面出现横向溢出").toBeLessThanOrEqual(widths.client);
}

test("统一成员与付款面板在手机和桌面保持一致交互", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "精确视口由 desktop-chromium 串行执行，避免重复创建活动。",
  );
  const suffix = uniqueScenarioSuffix();
  const guestName = `临时付款人 ${suffix.slice(-4)}`;

  await signInThroughUi(page);
  const activityId = await createActivityThroughUi(
    page,
    `成员选择器验收 ${suffix}`,
  );

  await openExpenseForm(page, activityId, { width: 390, height: 844 }, "light");
  await page.getByLabel("金额", { exact: true }).fill("100");
  const payerTrigger = page.getByRole("button", { name: "谁付款" });
  await expectTouchTarget(payerTrigger, "谁付款");
  await payerTrigger.click();
  const mobilePayer = page.getByRole("dialog", { name: "谁付款" });
  await expect(mobilePayer).toHaveAttribute("data-slot", "sheet-content");
  await mobilePayer.getByRole("button", { name: "添加临时成员" }).click();
  await page.getByLabel("临时成员昵称").fill(guestName);
  await page.getByRole("button", { name: "确认添加" }).click();
  await expect(payerTrigger).toContainText(guestName);
  await expect(payerTrigger).toBeFocused();

  await payerTrigger.click();
  await page.getByRole("button", { name: "多人付款" }).click();
  const payerOptions = await page.getByRole("checkbox").all();
  const payerLabels = await Promise.all(
    payerOptions.map((option) => option.getAttribute("aria-label")),
  );
  const otherPayer =
    payerOptions[payerLabels.findIndex((name) => name !== guestName)];
  expect(otherPayer, "多人付款面板缺少另一名活动成员").toBeDefined();
  await otherPayer!.click();
  const amountInputs = await page.getByLabel(/付款金额$/).all();
  expect(amountInputs).toHaveLength(2);
  for (const input of amountInputs) await input.fill("50");
  const payerComplete = page.getByRole("button", { name: "完成" });
  await expectTouchTarget(payerComplete, "多人付款完成");
  await payerComplete.click();
  await expect(payerTrigger).toContainText("2 人");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("member-picker-390x844-light.png"),
    animations: "disabled",
  });

  await openExpenseForm(page, activityId, { width: 390, height: 844 }, "dark");
  const participantTrigger = page.getByRole("button", { name: "谁参与" });
  await participantTrigger.click();
  const mobileParticipants = page.getByRole("dialog", { name: "谁参与" });
  await expect(mobileParticipants).toHaveAttribute(
    "data-slot",
    "sheet-content",
  );
  await expectTouchTarget(
    mobileParticipants.getByRole("button", { name: "完成" }),
    "参与者完成",
  );
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("member-picker-390x844-dark.png"),
    animations: "disabled",
  });

  await mobileParticipants
    .getByRole("button", { name: "返回快速记账" })
    .click();
  await expect(page.getByRole("heading", { name: "记一笔" })).toBeVisible();

  await participantTrigger.click();
  const reopenedParticipants = page.getByRole("dialog", { name: "谁参与" });
  await expect(reopenedParticipants).toBeVisible();
  await reopenedParticipants.getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("dialog", { name: "谁参与" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "记一笔" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "记一笔" })).toBeFocused();

  await openExpenseForm(
    page,
    activityId,
    { width: 1440, height: 1000 },
    "light",
  );
  await page.getByRole("button", { name: "谁付款" }).click();
  const desktopPayer = page.getByRole("dialog", { name: "谁付款" });
  await expect(desktopPayer).toHaveAttribute("data-slot", "dialog-content");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("member-picker-1440x1000-light.png"),
    animations: "disabled",
  });
  await desktopPayer.getByRole("button", { name: "关闭" }).click();

  await openExpenseForm(
    page,
    activityId,
    { width: 1440, height: 1000 },
    "dark",
  );
  await page.getByRole("button", { name: "谁参与" }).click();
  const desktopParticipants = page.getByRole("dialog", { name: "谁参与" });
  await expect(desktopParticipants).toHaveAttribute(
    "data-slot",
    "dialog-content",
  );
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("member-picker-1440x1000-dark.png"),
    animations: "disabled",
  });
});

test("金额输入框保持中轴并在极窄屏上下换行", async ({ page }) => {
  await signInThroughUi(page);
  const activityId = await createActivityThroughUi(
    page,
    `金额中轴验收 ${uniqueScenarioSuffix()}`,
  );

  await openExpenseForm(page, activityId, { width: 390, height: 844 }, "light");
  await page
    .getByLabel("金额", { exact: true })
    .fill("12345678901234567890.12");
  await expectAmountCentered(page);

  await openExpenseForm(
    page,
    activityId,
    { width: 1440, height: 1000 },
    "light",
  );
  await expectAmountCentered(page);

  await openExpenseForm(page, activityId, { width: 320, height: 844 }, "light");
  const narrowCurrency = page.getByRole("button", { name: "币种" });
  const narrowAmount = page.getByLabel("金额", { exact: true });
  await narrowAmount.fill("12345678901234567890.12");
  const [narrowCurrencyBox, narrowAmountBox] = await Promise.all([
    narrowCurrency.boundingBox(),
    narrowAmount.boundingBox(),
  ]);
  expect(narrowCurrencyBox).not.toBeNull();
  expect(narrowAmountBox).not.toBeNull();
  expect(narrowAmountBox!.y).toBeGreaterThan(narrowCurrencyBox!.y);
  await expectAmountCentered(page);
});
