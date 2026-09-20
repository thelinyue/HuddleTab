import { expect, test } from "@playwright/test";

import {
  assertExpenseEditorScrollBoundary,
  assertNoHorizontalOverflow,
  createActivity,
  fillQuickExpenseBasics,
  login,
  openExpenseNoteView,
  openQuickExpense,
  saveChromiumSuccessScreenshot,
} from "./support/product";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function boxesOverlap(first: { x: number; y: number; width: number; height: number }, second: { x: number; y: number; width: number; height: number }) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

test("离线图片附件恢复联网后可查看并即时删除", async ({ page, context }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const title = `附件餐费 ${suffix}`;

  await login(page);
  await createActivity(page, `Attachment ${suffix}`);
  const navigation = page.getByRole("navigation", { name: "活动导航" });
  await expect(navigation.getByRole("link")).toHaveText(["流水", "结算"]);
  const dialog = await openQuickExpense(page);
  await fillQuickExpenseBasics(dialog, "12.34", title);
  await openExpenseNoteView(dialog);
  await dialog.getByLabel("图片（最多三张）").setInputFiles([
    { name: "receipt-a.png", mimeType: "image/png", buffer: onePixelPng },
    { name: "receipt-b.png", mimeType: "image/png", buffer: onePixelPng },
  ]);
  await expect(dialog.getByRole("img", { name: "receipt-a.png 图片缩略图" })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "receipt-b.png 图片缩略图" })).toBeVisible();
  await dialog.getByRole("button", { name: "预览图片 receipt-b.png" }).click();
  await expect(page.getByRole("dialog", {
    name: "图片大图预览 receipt-b.png",
  })).toBeVisible();
  await page.getByRole("button", { name: "关闭图片预览", exact: true }).click();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const pendingExpense = page.locator(".expense-row--pending").filter({
    hasText: title,
  });
  await expect(pendingExpense).toContainText("等待同步");

  await context.setOffline(false);
  const expenseLink = page.getByRole("link", { name: new RegExp(title) });
  await expect(expenseLink).toBeVisible();
  await expenseLink.click();
  const editor = page.locator(".quick-expense-overlay .form-overlay__sheet");
  await expect(editor.getByRole("heading", { name: "修改账单" })).toBeVisible();
  await openExpenseNoteView(editor);
  await assertExpenseEditorScrollBoundary(page, editor);
  const previews = page.getByRole("img", { name: /^图片 \d+$/ });
  await expect(previews).toHaveCount(2);
  const href = await page.getByRole("link", { name: "查看图片 1" }).getAttribute("href");
  expect(href).toBeTruthy();
  const download = await page.request.get(href!);
  expect(download.ok()).toBeTruthy();
  expect(download.headers()["content-type"]).toContain("image/webp");
  expect(download.headers()["cache-control"]).toBe("private, no-cache");
  expect(download.headers().etag).toBeTruthy();
  expect(download.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await download.body()).subarray(0, 4).toString("ascii")).toBe("RIFF");

  const thumbnail = await page.request.get(`${href}?variant=thumbnail`);
  expect(thumbnail.ok()).toBeTruthy();
  expect(thumbnail.headers()["cache-control"]).toBe("private, no-cache");
  expect(thumbnail.headers().etag).toBeTruthy();
  expect(thumbnail.headers().etag).not.toBe(download.headers().etag);
  const cachedThumbnail = await page.request.get(`${href}?variant=thumbnail`, {
    headers: { "If-None-Match": thumbnail.headers().etag },
  });
  expect(cachedThumbnail.status()).toBe(304);

  let releaseOriginal!: () => void;
  let markOriginalRequested!: () => void;
  const originalRequested = new Promise<void>((resolve) => { markOriginalRequested = resolve; });
  const originalRelease = new Promise<void>((resolve) => { releaseOriginal = resolve; });
  const attachmentRoute = "**/api/activities/**/expenses/**/attachments/**";
  await page.route(attachmentRoute, async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("variant")) {
      markOriginalRequested();
      await originalRelease;
    }
    await route.continue();
  });
  await page.getByRole("link", { name: "查看图片 1" }).click();
  await originalRequested;
  const preview = page.getByRole("dialog", { name: "图片大图预览 1" });
  const loading = preview.locator(".attachment-lightbox__loading");
  const close = preview.getByRole("button", { name: "关闭图片预览", exact: true });
  const original = preview.getByRole("link", { name: "打开原图" });
  await expect(loading).toHaveText("正在加载原图…");
  await expect(original).toHaveCSS("white-space", "nowrap");
  const loadingBox = await loading.boundingBox();
  const closeBox = await close.boundingBox();
  const originalBox = await original.boundingBox();
  if (!loadingBox || !closeBox || !originalBox) throw new Error("无法读取原图预览控件尺寸");
  expect(boxesOverlap(loadingBox, closeBox)).toBe(false);
  expect(boxesOverlap(loadingBox, originalBox)).toBe(false);
  expect(boxesOverlap(closeBox, originalBox)).toBe(false);
  await assertNoHorizontalOverflow(page);

  releaseOriginal();
  await expect(loading).toHaveCount(0);
  await expect(preview.locator(".attachment-lightbox__full")).toHaveClass(/loaded/);
  await page.unroute(attachmentRoute);
  await close.click();

  await page.getByRole("button", { name: "删除图片 1" }).click();
  const deleteConfirmation = page.getByRole("alertdialog", { name: "删除图片" });
  await expect(deleteConfirmation).toBeVisible();
  await deleteConfirmation.getByRole("button", { name: "确认删除" }).click();
  await expect(previews).toHaveCount(1);
  await assertNoHorizontalOverflow(page);
  await saveChromiumSuccessScreenshot(page, testInfo);
});
