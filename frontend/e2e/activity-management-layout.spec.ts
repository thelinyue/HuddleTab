import { expect, test } from "@playwright/test";

import { assertNoHorizontalOverflow, createActivity, login } from "./support/product";

test.use({ serviceWorkers: "block" });

test("活动管理字段、命令与 PWA 导出在目标视口保持统一", async ({ page }, testInfo) => {
  await login(page);
  const activityName = `管理布局 ${testInfo.project.name}-${Date.now()}`;
  await createActivity(page, activityName);
  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("navigation", { name: "活动操作" }).getByRole("link", { name: "活动管理" }).click();
  const management = page.getByRole("dialog", { name: "活动管理" });
  await expect(management).toBeVisible();

  await expect(management.getByRole("list")).toHaveCount(1);
  await expect(management.locator(".activity-more > section > h2")).toHaveCount(0);
  await expect(management.getByRole("listitem")).toHaveCount(12);
  await assertNoHorizontalOverflow(page);

  const geometry = await management.evaluate((dialog) => {
    const fields = [...dialog.querySelectorAll<HTMLElement>(".management-field")];
    const fieldTitleEdges = fields.map((field) =>
      field.querySelector<HTMLElement>(".management-field__heading strong")?.getBoundingClientRect().left ?? 0,
    );
    const valueEdges = fields.map((field) => {
      const value = field.querySelector<HTMLElement>(".management-field__control .input, .management-choice-trigger > span:first-child, .management-date-trigger > span:first-child, .management-field__readonly");
      return value?.getBoundingClientRect().right ?? 0;
    });
    const statusEdges = fields.map((field) => {
      const status = field.querySelector<HTMLElement>(".management-field__status");
      return status?.getBoundingClientRect().right ?? 0;
    });
    const actionHeights = [...dialog.querySelectorAll<HTMLElement>(".management-action-row")]
      .map((row) => row.getBoundingClientRect().height);
    const actionTitleEdges = [...dialog.querySelectorAll<HTMLElement>(".management-action-row strong")]
      .map((title) => title.getBoundingClientRect().left);
    const descriptions = [...dialog.querySelectorAll<HTMLElement>(".management-field__heading > span, .management-action-row > span:not(.management-action-row__status)")]
      .flatMap((group) => {
        const title = group.querySelector<HTMLElement>("strong");
        const description = group.querySelector<HTMLElement>("small");
        if (!title || !description) return [];
        const titleBounds = title.getBoundingClientRect();
        const descriptionBounds = description.getBoundingClientRect();
        return [{
          title: title.textContent,
          aligned: descriptionBounds.left >= titleBounds.right
            && Math.abs((descriptionBounds.top + descriptionBounds.bottom) - (titleBounds.top + titleBounds.bottom)) <= 2,
          visible: title.scrollWidth <= title.clientWidth + 1 && description.scrollWidth <= description.clientWidth + 1,
        }];
      });
    return { actionHeights, actionTitleEdges, descriptions, fieldTitleEdges, statusEdges, valueEdges };
  });
  expect(geometry.actionTitleEdges).toHaveLength(6);
  expect(Math.max(...geometry.fieldTitleEdges, ...geometry.actionTitleEdges) - Math.min(...geometry.fieldTitleEdges, ...geometry.actionTitleEdges)).toBeLessThanOrEqual(1);
  expect(Math.max(...geometry.valueEdges) - Math.min(...geometry.valueEdges)).toBeLessThanOrEqual(1);
  expect(Math.max(...geometry.statusEdges) - Math.min(...geometry.statusEdges)).toBeLessThanOrEqual(1);
  expect(Math.min(...geometry.actionHeights)).toBeGreaterThanOrEqual(44);
  expect(geometry.descriptions.map(({ title }) => title)).toEqual(["封面", "地点", "导出 CSV", "活动记录"]);
  expect(geometry.descriptions.every(({ aligned, visible }) => aligned && visible)).toBe(true);
  for (const title of ["结束活动", "转让所有权", "删除活动"]) {
    await expect(management.getByRole("button", { name: title }).locator("small")).toHaveCount(0);
  }

  await management.getByRole("button", { name: /^活动日期/ }).click();
  await expect(page.getByText("选择活动日期")).toBeVisible();
  await expect(page.locator(".management-date-popover .rdp-root")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  const dateGeometry = await page.locator(".management-date-popover").evaluate((popover) => {
    const bounds = popover.getBoundingClientRect();
    const days = [...popover.querySelectorAll<HTMLElement>(".rdp-day_button")];
    const grid = popover.querySelector<HTMLElement>(".rdp-month_grid")!;
    const style = getComputedStyle(popover);
    return {
      left: bounds.left,
      right: bounds.right,
      daysFit: days.length > 0 && days.every((day) => day.getBoundingClientRect().width <= (day.parentElement?.getBoundingClientRect().width ?? 0) + 1),
      unusedWidth: popover.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) - grid.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
    };
  });
  expect(dateGeometry.left).toBeGreaterThanOrEqual(0);
  expect(dateGeometry.right).toBeLessThanOrEqual(dateGeometry.viewportWidth);
  expect(dateGeometry.daysFit).toBe(true);
  expect(dateGeometry.unusedWidth).toBeLessThanOrEqual(2);
  const pickerScreenshot = testInfo.outputPath(`activity-date-picker-${page.viewportSize()?.width}x${page.viewportSize()?.height}.png`);
  await page.screenshot({ path: pickerScreenshot });
  await testInfo.attach("活动日期选择器", { path: pickerScreenshot, contentType: "image/png" });
  const calendarDays = page.locator(".management-date-popover .rdp-day:not(.rdp-outside):not(.rdp-disabled) .rdp-day_button");
  await calendarDays.nth(0).click();
  await calendarDays.nth(1).click();
  await expect(page.locator(".management-date-popover__range")).not.toContainText("未设置");
  const rangeScreenshot = testInfo.outputPath(`activity-date-range-${page.viewportSize()?.width}x${page.viewportSize()?.height}.png`);
  await page.screenshot({ path: rangeScreenshot });
  await testInfo.attach("活动日期范围", { path: rangeScreenshot, contentType: "image/png" });
  await page.getByRole("button", { name: "取消" }).click();
  expect(await management.locator(".management-date-value > span").evaluateAll((parts) => parts.every((part) => part.scrollWidth <= part.clientWidth + 1))).toBe(true);

  const currency = management.getByRole("button", { name: /CNY 人民币/ });
  await currency.click();
  await expect(management.getByRole("radiogroup", { name: "主币种选项" })).toBeVisible();
  await management.getByRole("button", { name: "直接加入" }).click();
  await expect(management.getByRole("radiogroup", { name: "主币种选项" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "加入方式选项" })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(management.locator(".management-action-row--command .lucide-chevron-right")).toHaveCount(0);
  await expect(management.locator(".management-action-row--navigate .lucide-chevron-right")).toHaveCount(3);

  const auditTrigger = management.getByRole("button", { name: /^活动记录/ });
  await auditTrigger.click();
  const auditDialog = page.getByRole("dialog", { name: "活动记录" });
  await expect(auditDialog).toBeVisible();
  await expect(auditDialog.getByText("创建了活动")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await auditDialog.getByRole("button", { name: "返回活动管理" }).click();
  await expect(page.getByRole("dialog", { name: "活动管理" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^活动记录/ })).toBeFocused();

  await page.evaluate(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as typeof window & { __sharedCsvName?: string }).__sharedCsvName = data.files?.[0]?.name;
      },
    });
  });
  const managementUrl = page.url();
  await management.getByRole("button", { name: "导出 CSV" }).click();
  await expect(management.getByText("CSV 已打开系统分享。")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __sharedCsvName?: string }).__sharedCsvName))
    .toBe("activity-export.csv");
  expect(page.url()).toBe(managementUrl);
  await expect(management).toBeVisible();

  await page.mouse.move(0, 0);
  const screenshot = testInfo.outputPath(`activity-management-${page.viewportSize()?.width}x${page.viewportSize()?.height}.png`);
  await page.screenshot({ path: screenshot });
  await testInfo.attach("活动管理对齐与 PWA 导出", { path: screenshot, contentType: "image/png" });
});
