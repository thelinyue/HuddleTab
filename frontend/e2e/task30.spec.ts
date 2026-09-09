import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { assertNoHorizontalOverflow, createActivity, fillQuickExpenseBasics, installArtifactVisualRedaction, login, openQuickExpense, saveChromiumSuccessScreenshot } from "./support/product";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function expectExportedPng(bytes: Buffer) {
  expect(bytes.subarray(0, pngSignature.length)).toEqual(pngSignature);
  expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
  expect(bytes.readUInt32BE(16)).toBe(1600);
}

test("Task 30 摘要复制分享、PNG 与 CSV 保持一屏分享与真实账务数据", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await installArtifactVisualRedaction(page.context());
  await page.goto("/login");
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
  await expect(page.locator("#share-summary-preview-card")).toBeVisible();
  await expect(page.locator("#share-summary-preview-card").getByText(/1笔账单/)).toBeVisible();
  expect(await page.getByText("¥42.00").count()).toBeGreaterThanOrEqual(2);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => undefined } });
  });
  await page.getByRole("button", { name: "复制完整摘要" }).click();
  await expect(page.getByRole("status")).toHaveText("完整摘要已复制。");

  if (testInfo.project.name.endsWith("-mobile")) {
    await page.evaluate(() => {
      const createObjectURL = URL.createObjectURL.bind(URL);
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: (value: Blob | MediaSource) => {
          if (value instanceof Blob && value.type === "image/png") {
            (window as typeof window & { __exportedPng?: Blob }).__exportedPng = value;
          }
          return createObjectURL(value);
        },
      });
    });
    await page.getByRole("button", { name: "保存本页图片" }).click();
    await expect(page.getByRole("status")).toHaveText("长按图片保存，或打开原图。");
    const preview = page.getByRole("img", { name: /PNG 预览/ });
    await expect(preview).toHaveAttribute("src", /^blob:/);
    await expect(preview).toHaveJSProperty("naturalWidth", 1600);
    const pngHeader = await page.evaluate(async () => {
      const blob = (window as typeof window & { __exportedPng?: Blob }).__exportedPng;
      if (!blob) throw new Error("测试没有捕获到导出的 PNG Blob");
      return [...new Uint8Array(await blob.arrayBuffer()).slice(0, 24)];
    });
    expectExportedPng(Buffer.from(pngHeader));
  } else {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "保存本页图片" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("huddletab-settlement-summary-1.png");
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    expectExportedPng(await readFile(downloadPath!));
  }
  await assertNoHorizontalOverflow(page);
  await saveChromiumSuccessScreenshot(page, testInfo);

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

  await page.goto(`/activities/${activityId}`);
  await expect(page.getByRole("navigation", { name: "活动导航" }).getByRole("link")).toHaveText(["流水", "结算"]);
});
