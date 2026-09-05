import { expect, test } from "@playwright/test";

import {
  assertNoHorizontalOverflow,
  createActivity,
  fillQuickExpenseBasics,
  login,
  openExpenseMoreSettings,
  openQuickExpense,
} from "./support/product";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("iPhone WebKit 模拟在线工作台、附件交互和移动布局", async ({ page }) => {
  const suffix = `WebKit iPhone-${Date.now()}`;
  const activityName = `iPhone 模拟 ${suffix}`;
  const expenseTitle = `手机早餐 ${suffix}`;

  await login(page);
  const activityId = await createActivity(page, activityName);
  const navigation = page.getByRole("navigation", { name: "活动导航" });
  await expect(navigation.getByRole("link")).toHaveText(["流水", "结算"]);

  const dialog = await openQuickExpense(page);
  await fillQuickExpenseBasics(dialog, "12.34", expenseTitle);
  await openExpenseMoreSettings(dialog);
  const attachmentInput = dialog.getByLabel("附件（最多三张）");
  await attachmentInput.setInputFiles([
    { name: "iphone-receipt-a.png", mimeType: "image/png", buffer: onePixelPng },
    { name: "iphone-receipt-b.png", mimeType: "image/png", buffer: onePixelPng },
  ]);
  await expect(dialog.getByRole("img", { name: "iphone-receipt-a.png 缩略图" })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "iphone-receipt-b.png 缩略图" })).toBeVisible();

  await dialog.getByRole("button", { name: "移除附件 iphone-receipt-a.png" }).click();
  await expect(dialog.getByRole("img", { name: "iphone-receipt-a.png 缩略图" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "预览附件 iphone-receipt-b.png" }).click();
  await expect(page.getByRole("dialog", { name: "附件大图预览 iphone-receipt-b.png" })).toBeVisible();
  await page.getByRole("button", { name: "关闭附件预览" }).click();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  // WebKit 不提供 Chromium 的 Service Worker 能力，持久化和同步由 Chromium Mobile 专项覆盖。
  await dialog.getByRole("button", { name: "关闭记一笔", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await navigation.getByRole("link", { name: "结算" }).click();
  await expect(page.getByRole("heading", { name: "推荐转账" })).toBeVisible();
  await navigation.getByRole("link", { name: "流水" }).click();
  await expect(page.getByRole("heading", { name: "全部流水" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/activities/${activityId}`));
  await assertNoHorizontalOverflow(page);
});

test("生产页面锁定 viewport，并声明 standalone、图标和 Apple touch icon", async ({ page, request }) => {
  await login(page);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
  );
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
  const data = await manifest.json() as {
    name?: string;
    short_name?: string;
    display?: string;
    icons?: Array<{ src?: string }>;
  };
  expect(data.name).toBe("HuddleTab / 伙记");
  expect(data.short_name).toBe("伙记");
  expect(data.display).toBe("standalone");
  for (const src of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/apple-touch-icon.png"]) {
    const response = await request.get(src);
    expect(response.status(), `${src} 不可访问`).toBe(200);
  }
});
