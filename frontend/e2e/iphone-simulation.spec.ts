import { expect, test } from "@playwright/test";

import {
  assertExpenseEditorScrollBoundary,
  assertNoHorizontalOverflow,
  assertQuickExpenseGeometry,
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

/** Playwright 无法唤起真机软键盘；用同形的 visualViewport 验证 Sheet 的布局响应。 */
async function simulateKeyboardViewport(page: import("@playwright/test").Page, offsetTop: number, height: number): Promise<void> {
  await page.evaluate(({ top, visibleHeight }) => {
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      offsetTop: { configurable: true, writable: true, value: top },
      height: { configurable: true, writable: true, value: visibleHeight },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  }, { top: offsetTop, visibleHeight: height });
}

async function resizeSimulatedViewport(page: import("@playwright/test").Page, offsetTop: number, height: number): Promise<void> {
  await page.evaluate(({ top, visibleHeight }) => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    Object.defineProperties(viewport, {
      offsetTop: { configurable: true, writable: true, value: top },
      height: { configurable: true, writable: true, value: visibleHeight },
    });
    viewport.dispatchEvent(new Event("resize"));
  }, { top: offsetTop, visibleHeight: height });
}

async function dismissSimulatedKeyboard(page: import("@playwright/test").Page): Promise<void> {
  const height = await page.evaluate(() => window.innerHeight);
  await resizeSimulatedViewport(page, 0, height);
}

test("iPhone WebKit 模拟在线工作台、附件交互和移动布局", async ({ page }) => {
  const suffix = `WebKit iPhone-${Date.now()}`;
  const activityName = `iPhone 模拟 ${suffix}`;
  const expenseTitle = `手机早餐 ${suffix}`;

  await login(page);
  const activityId = await createActivity(page, activityName);
  const navigation = page.getByRole("navigation", { name: "活动导航" });
  await expect(navigation.getByRole("link")).toHaveText(["流水", "结算"]);

  const initialViewportHeight = await page.evaluate(() => window.innerHeight);
  await simulateKeyboardViewport(page, 0, initialViewportHeight);
  const dialog = await openQuickExpense(page);
  await openExpenseMoreSettings(dialog);
  await resizeSimulatedViewport(page, 80, 360);
  await assertQuickExpenseGeometry(page, dialog);
  const keyboardContent = dialog.locator(".quick-expense-entry");
  await expect(keyboardContent).toHaveCSS("overflow-y", "auto");
  await expect.poll(() => keyboardContent.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(0);
  await dismissSimulatedKeyboard(page);
  await assertExpenseEditorScrollBoundary(page, dialog);
  await fillQuickExpenseBasics(dialog, "12.34", expenseTitle);
  for (const view of ["谁付款", "谁参与", "分摊设置", "币种"] as const) {
    await dialog.getByRole("button", { name: view, exact: true }).click();
    const title = view === "币种" ? "选择币种" : view;
    const subview = page.getByRole("dialog", { name: title, exact: true });
    await assertExpenseEditorScrollBoundary(page, subview);
    await subview.getByRole("button", { name: "记一笔", exact: true }).click();
  }
  await assertExpenseEditorScrollBoundary(page, dialog);
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
  await page.getByRole("link", { name: "生成分享摘要" }).click();
  await expect(page.getByRole("heading", { name: "结算分享摘要" })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (data: ShareData) => data.files?.[0]?.type === "image/png" });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        if (!file) throw new Error("缺少 PNG 文件");
        const bytes = new Uint8Array(await file.arrayBuffer());
        (window as typeof window & { __sharedPng?: { name: string; type: string; signature: number[] } }).__sharedPng = {
          name: file.name,
          type: file.type,
          signature: [...bytes.slice(0, 8)],
        };
      },
    });
  });
  await page.getByRole("button", { name: "下载 PNG" }).click();
  await expect(page.getByRole("status")).toHaveText("PNG 已交给系统分享。");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __sharedPng?: unknown }).__sharedPng)).toEqual({
    name: "huddletab-settlement-summary.png",
    type: "image/png",
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  });

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new Error("share unavailable"); } });
  });
  await page.getByRole("button", { name: "下载 PNG" }).click();
  await expect(page.getByRole("alert")).toHaveText("系统分享未能打开，已改为显示 PNG 原图。");
  await expect(page.getByRole("img", { name: /PNG 预览/ })).toHaveAttribute("src", /^blob:/);
  await expect(page.getByRole("link", { name: "打开原图" })).toHaveAttribute("href", /^blob:/);
  await assertNoHorizontalOverflow(page);

  await page.getByRole("link", { name: "返回结算" }).click();
  await navigation.getByRole("link", { name: "流水" }).click();
  await expect(page.getByRole("heading", { name: "全部流水" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/activities/${activityId}`));
  await assertNoHorizontalOverflow(page);
});

test("生产页面锁定 viewport，并声明 standalone、图标和 Apple touch icon", async ({ page, request }) => {
  await login(page);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
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

test("iPhone WebKit 的主题、昵称和退出操作适配底部 Sheet", async ({ page }) => {
  await login(page);
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "我的", exact: true })).toBeVisible();
  await expect(page.locator(".profile-identity-button small")).not.toContainText("@");

  const viewportHeight = await page.evaluate(() => window.innerHeight);
  await page.getByRole("button", { name: "主题：跟随系统" }).click();
  const themeSheet = page.getByRole("dialog", { name: "主题" });
  const productNavigation = page.getByRole("navigation", { name: "主导航" });
  await expect(themeSheet.getByRole("radio")).toHaveCount(3);
  await expect.poll(() => themeSheet.evaluate((element) => Math.round(element.getBoundingClientRect().bottom)))
    .toBe(viewportHeight);
  await themeSheet.getByRole("radio", { name: "亮色" }).click();
  const lightNavigationBackground = await productNavigation.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await themeSheet.getByRole("radio", { name: "暗色" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0d1512");
  await expect.poll(() => productNavigation.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )).not.toBe(lightNavigationBackground);
  await expect.poll(() => productNavigation.evaluate(
    (element) => Math.round(element.getBoundingClientRect().bottom),
  )).toBe(viewportHeight);
  await themeSheet.getByRole("button", { name: "关闭主题" }).click();

  await simulateKeyboardViewport(page, 100, 420);
  await page.getByRole("button", { name: "修改昵称" }).click();
  const nicknameSheet = page.getByRole("dialog", { name: "修改昵称" });
  const nicknameInput = nicknameSheet.getByRole("textbox", { name: "昵称" });
  await expect(nicknameInput).toBeFocused();
  await expect.poll(() => nicknameSheet.evaluate((element) => Math.round(element.getBoundingClientRect().bottom)))
    .toBe(520);
  const nicknameGeometry = await nicknameSheet.evaluate((element) => {
    const input = element.querySelector<HTMLInputElement>("input")!.getBoundingClientRect();
    const save = element.querySelector<HTMLButtonElement>('button[type="submit"]')!.getBoundingClientRect();
    return { inputTop: input.top, inputBottom: input.bottom, saveBottom: save.bottom };
  });
  expect(nicknameGeometry.inputTop).toBeGreaterThanOrEqual(100);
  expect(nicknameGeometry.inputBottom).toBeLessThanOrEqual(520);
  expect(nicknameGeometry.saveBottom).toBeLessThanOrEqual(520);
  await assertNoHorizontalOverflow(page);
  await nicknameSheet.getByRole("button", { name: "关闭修改昵称" }).click();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("用户名")).toBeVisible();
});
