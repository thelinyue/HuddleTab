import { expect, test } from "@playwright/test";

import { assertNoHorizontalOverflow, createActivity, login } from "./support/product";

test.use({ serviceWorkers: "block" });

test("活动管理字段、命令与 PWA 导出在目标视口保持统一", async ({ page }, testInfo) => {
  await login(page);
  const activityName = `管理布局 ${testInfo.project.name}-${Date.now()}`;
  await createActivity(page, activityName);
  await page.getByRole("link", { name: "活动管理" }).click();
  const management = page.getByRole("dialog", { name: "活动管理" });
  await expect(management).toBeVisible();

  await expect(management.getByRole("list")).toHaveCount(1);
  await expect(management.locator(".activity-more > section > h2")).toHaveCount(0);
  await expect(management.getByRole("listitem")).toHaveCount(11);
  await assertNoHorizontalOverflow(page);

  const geometry = await management.evaluate((dialog) => {
    const fields = [...dialog.querySelectorAll<HTMLElement>(".management-field")];
    const fieldTitleEdges = fields.map((field) =>
      field.querySelector<HTMLElement>(".management-field__heading strong")?.getBoundingClientRect().left ?? 0,
    );
    const valueEdges = fields.map((field) => {
      const value = field.querySelector<HTMLElement>(".management-field__control .input, .management-choice-trigger > span:first-child, .management-field__readonly");
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
    return { actionHeights, actionTitleEdges, fieldTitleEdges, statusEdges, valueEdges };
  });
  expect(geometry.actionTitleEdges).toHaveLength(4);
  expect(Math.max(...geometry.fieldTitleEdges, ...geometry.actionTitleEdges) - Math.min(...geometry.fieldTitleEdges, ...geometry.actionTitleEdges)).toBeLessThanOrEqual(1);
  expect(Math.max(...geometry.valueEdges) - Math.min(...geometry.valueEdges)).toBeLessThanOrEqual(1);
  expect(Math.max(...geometry.statusEdges) - Math.min(...geometry.statusEdges)).toBeLessThanOrEqual(1);
  expect(Math.min(...geometry.actionHeights)).toBeGreaterThanOrEqual(44);

  const currency = management.getByRole("button", { name: /CNY 人民币/ });
  await currency.click();
  await expect(management.getByRole("radiogroup", { name: "主币种选项" })).toBeVisible();
  await management.getByRole("button", { name: "直接加入" }).click();
  await expect(management.getByRole("radiogroup", { name: "主币种选项" })).toHaveCount(0);
  await expect(management.getByRole("radiogroup", { name: "加入方式选项" })).toBeVisible();
  await management.getByRole("button", { name: "直接加入" }).click();

  await expect(management.locator(".management-action-row--command .lucide-chevron-right")).toHaveCount(0);
  await expect(management.locator(".management-action-row--navigate .lucide-chevron-right")).toHaveCount(1);

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
