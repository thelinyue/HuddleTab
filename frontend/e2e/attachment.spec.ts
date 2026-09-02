import { expect, test } from "@playwright/test";

import {
  assertNoHorizontalOverflow,
  createActivity,
  login,
  saveChromiumSuccessScreenshot,
} from "./support/product";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("离线图片附件恢复联网后可查看并即时删除", async ({ page, context }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const title = `附件餐费 ${suffix}`;

  await login(page);
  await createActivity(page, `Attachment ${suffix}`);
  const navigation = page.getByRole("navigation", { name: "活动导航" });
  await expect(navigation.getByRole("link")).toHaveText(["流水", "结算"]);
  await page.getByRole("button", { name: "快速记账" }).click();
  const dialog = page.getByRole("dialog", { name: "记一笔消费" });
  await dialog.locator(".amount-input input").fill("12.34");
  await dialog.getByLabel("标题").fill(title);
  await dialog.getByLabel("附件（最多三张）").setInputFiles([
    { name: "receipt-a.png", mimeType: "image/png", buffer: onePixelPng },
    { name: "receipt-b.png", mimeType: "image/png", buffer: onePixelPng },
  ]);
  await expect(dialog.getByRole("img", { name: "receipt-a.png 缩略图" })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "receipt-b.png 缩略图" })).toBeVisible();
  await dialog.getByRole("button", { name: "预览附件 receipt-b.png" }).click();
  await expect(page.getByRole("dialog", {
    name: "附件大图预览 receipt-b.png",
  })).toBeVisible();
  await page.getByRole("button", { name: "关闭附件预览" }).click();
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await dialog.getByRole("button", { name: "保存账单" }).click();
  const pendingExpense = page.locator(".expense-row--pending").filter({
    hasText: title,
  });
  await expect(pendingExpense).toContainText("等待同步");

  await context.setOffline(false);
  const expenseLink = page.getByRole("link", { name: new RegExp(title) });
  await expect(expenseLink).toBeVisible();
  await expenseLink.click();
  const previews = page.getByRole("img", { name: /^附件 \d+$/ });
  await expect(previews).toHaveCount(2);
  const href = await page.getByRole("link", { name: "查看附件 1" }).getAttribute("href");
  expect(href).toBeTruthy();
  const download = await page.request.get(href!);
  expect(download.ok()).toBeTruthy();
  expect(download.headers()["content-type"]).toContain("image/webp");
  expect(download.headers()["cache-control"]).toBe("private, no-store");
  expect(download.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await download.body()).subarray(0, 4).toString("ascii")).toBe("RIFF");

  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "删除附件 1" }).click();
  await expect(previews).toHaveCount(1);
  await assertNoHorizontalOverflow(page);
  await saveChromiumSuccessScreenshot(page, testInfo);
});
