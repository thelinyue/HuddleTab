import { expect, test } from "@playwright/test";

import {
  assertExpenseEditorScrollBoundary,
  assertActivityChrome,
  assertNoHorizontalOverflow,
  assertQuickExpenseGeometry,
  createActivity,
  fillQuickExpenseBasics,
  login,
  openQuickExpense,
} from "./support/product";

test.use({ serviceWorkers: "block" });

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  });
});

test("独立 PWA 冷启动先展示品牌接管层，再交给活动首页", async ({ page }) => {
  await login(page);

  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  });
  let setupStatusRequestIntercepted = false;
  await page.route("**/api/setup/status**", async (route) => {
    setupStatusRequestIntercepted = true;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { setupRequired: false } }),
    });
  });
  await page.reload();

  await expect.poll(() => setupStatusRequestIntercepted).toBe(true);
  const launchScreen = page.getByRole("status", { name: "正在准备伙记" });
  await expect(launchScreen).toBeVisible();
  await expect(page.locator(".pwa-launch-screen__status")).toBeVisible();
  await expect(page.getByRole("heading", { name: "活动", exact: true })).toBeVisible();
  await expect(launchScreen).toHaveCount(0);
});

async function setSafeAreaVariables(
  page: import("@playwright/test").Page,
  insets: { top: number; right: number; bottom: number; left: number },
): Promise<void> {
  await page.locator("html").evaluate((root, values) => {
    root.style.setProperty("--safe-area-top", `${values.top}px`);
    root.style.setProperty("--safe-area-right", `${values.right}px`);
    root.style.setProperty("--safe-area-bottom", `${values.bottom}px`);
    root.style.setProperty("--safe-area-left", `${values.left}px`);
  }, insets);
}

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
  await assertActivityChrome(page, { themeColor: "#f6f8f7", backgroundColor: "rgb(246, 248, 247)", translucentHeader: true });
  await page.evaluate(() => localStorage.setItem("huddletab-theme", "dark"));
  await page.reload();
  await expect(page.getByRole("heading", { name: activityName, exact: true })).toBeVisible();
  await assertActivityChrome(page, { themeColor: "#0d1512", backgroundColor: "rgb(13, 21, 18)", translucentHeader: false });
  await page.evaluate(() => localStorage.setItem("huddletab-theme", "light"));
  await page.reload();
  await expect(page.getByRole("heading", { name: activityName, exact: true })).toBeVisible();
  await setSafeAreaVariables(page, { top: 47, right: 13, bottom: 34, left: 11 });
  await expect(page.locator(".workspace-header")).toHaveCSS("padding-top", "47px");
  const portraitChrome = await page.evaluate(() => {
    const headerButton = document.querySelector<HTMLElement>(".workspace-header .back-link")!.getBoundingClientRect();
    const fab = document.querySelector<HTMLElement>(".quick-expense-trigger")!.getBoundingClientRect();
    return {
      headerButtonTop: headerButton.top,
      fabRightGap: window.innerWidth - fab.right,
      fabBottomGap: window.innerHeight - fab.bottom,
    };
  });
  expect(portraitChrome.headerButtonTop).toBeGreaterThanOrEqual(47);
  expect(portraitChrome.fabRightGap).toBeGreaterThanOrEqual(29);
  expect(portraitChrome.fabBottomGap).toBeGreaterThanOrEqual(52);

  const initialViewportHeight = await page.evaluate(() => window.innerHeight);
  await simulateKeyboardViewport(page, 0, initialViewportHeight);
  const dialog = await openQuickExpense(page);
  const sheetSafeArea = await dialog.evaluate((element) => {
    const close = element.querySelector<HTMLElement>(".form-overlay__header > .icon-button")!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return { closeTop: close.top, left: bounds.left, rightGap: window.innerWidth - bounds.right };
  });
  expect(sheetSafeArea.closeTop).toBeGreaterThanOrEqual(47);
  expect(sheetSafeArea.left).toBeGreaterThanOrEqual(11);
  expect(sheetSafeArea.rightGap).toBeGreaterThanOrEqual(13);
  await dialog.getByLabel("用途").click();
  await resizeSimulatedViewport(page, 80, 360);
  await assertQuickExpenseGeometry(page, dialog);
  const keyboardContent = dialog.locator(".form-overlay__body");
  await expect(keyboardContent).toHaveCSS("overflow-y", "auto");
  await expect(keyboardContent).toHaveCSS("touch-action", "pan-y");
  await expect(dialog.locator(".quick-expense-entry")).toHaveCSS("overflow-y", "visible");
  await expect.poll(() => keyboardContent.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(0);
  const keyboardScrollTop = await keyboardContent.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(keyboardScrollTop).toBeGreaterThan(0);
  await expect(dialog.getByRole("button", { name: /^备注：/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeVisible();
  await dismissSimulatedKeyboard(page);
  await assertExpenseEditorScrollBoundary(page, dialog);
  await fillQuickExpenseBasics(dialog, "12.34", expenseTitle);
  for (const view of [
    { trigger: /^付款人：/, title: "付款人" },
    { trigger: /^参与人：/, title: "参与人" },
    { trigger: /^分摊设置：/, title: "分摊设置" },
    { trigger: /^币种：/, title: "选择币种" },
  ] as const) {
    await dialog.getByRole("button", { name: view.trigger }).click();
    const title = view.title;
    const subview = page.getByRole("dialog", { name: title, exact: true });
    await assertExpenseEditorScrollBoundary(page, subview);
    await subview.getByRole("button", { name: "记一笔", exact: true }).click();
  }
  await assertExpenseEditorScrollBoundary(page, dialog);
  await dialog.getByRole("button", { name: /^备注：/ }).click();
  await expect(page.getByRole("dialog", { name: "备注与附件" })).toBeVisible();
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
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
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
  await expect(page.locator("html")).toHaveClass(/pwa-standalone/);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "伙记");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
  const navigation = page.getByRole("navigation", { name: "主导航" });
  await expect(navigation).toHaveCSS("position", "fixed");
  expect(await navigation.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter");
  })).toContain("blur");
  const calloutStyles = await page.evaluate(() => {
    const internal = document.createElement("a");
    internal.href = "/activities";
    const download = document.createElement("a");
    download.href = "/api/activities/export.csv";
    document.body.append(internal, download);
    const result = {
      internalMatches: internal.matches('.pwa-standalone a[href^="/"]:not([href^="/api"])'),
      downloadMatches: download.matches('.pwa-standalone a[href^="/"]:not([href^="/api"])'),
    };
    internal.remove();
    download.remove();
    return result;
  });
  expect(calloutStyles.internalMatches).toBe(true);
  expect(calloutStyles.downloadMatches).toBe(false);
  const generatedCss = await page.evaluate(async () => (await Promise.all(
    [...document.styleSheets]
      .map((sheet) => sheet.href)
      .filter((href): href is string => Boolean(href))
      .map(async (href) => (await fetch(href)).text()),
  )).join("\n"));
  expect(generatedCss).toContain("-webkit-touch-callout:none");
  expect(generatedCss).toMatch(/:not\(\[href\^=(?:["']?\\?\/api["']?)\]\)/);
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
  const data = await manifest.json() as {
    name?: string;
    short_name?: string;
    display?: string;
    theme_color?: string;
    background_color?: string;
    icons?: Array<{ src?: string }>;
  };
  expect(data.name).toBe("HuddleTab / 伙记");
  expect(data.short_name).toBe("伙记");
  expect(data.display).toBe("standalone");
  expect(data.theme_color).toBe("#f6f8f7");
  expect(data.background_color).toBe("#f6f8f7");
  for (const src of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/apple-touch-icon.png"]) {
    const response = await request.get(src);
    expect(response.status(), `${src} 不可访问`).toBe(200);
  }
});

test("iPhone 横屏安全区和固定控件保持互不遮挡", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/activities");
  await expect(page.locator(".home-header")).toBeVisible();
  await setSafeAreaVariables(page, { top: 0, right: 59, bottom: 21, left: 59 });

  const geometry = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".home-header")!.getBoundingClientRect();
    const navigation = document.querySelector<HTMLElement>(".product-bottom-nav")!.getBoundingClientRect();
    const prompt = document.createElement("aside");
    prompt.className = "update-prompt";
    prompt.textContent = "更新提示";
    document.body.append(prompt);
    const promptBounds = prompt.getBoundingClientRect();
    prompt.remove();
    return {
      headerLeft: header.left,
      headerRightGap: window.innerWidth - header.right,
      navigationLeft: navigation.left,
      navigationRightGap: window.innerWidth - navigation.right,
      navigationTop: navigation.top,
      promptBottom: promptBounds.bottom,
    };
  });
  expect(geometry.headerLeft).toBeGreaterThanOrEqual(59);
  expect(geometry.headerRightGap).toBeGreaterThanOrEqual(59);
  expect(geometry.navigationLeft).toBeGreaterThanOrEqual(59);
  expect(geometry.navigationRightGap).toBeGreaterThanOrEqual(59);
  expect(geometry.promptBottom).toBeLessThan(geometry.navigationTop);
  await assertNoHorizontalOverflow(page);
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
  await expect.poll(() => productNavigation.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter");
  })).toBe("none");
  await expect.poll(() => productNavigation.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )).not.toBe(lightNavigationBackground);
  await expect.poll(() => productNavigation.evaluate(
    (element) => Math.round(window.innerHeight - element.getBoundingClientRect().bottom),
  )).toBeGreaterThanOrEqual(8);
  await themeSheet.getByRole("button", { name: "关闭主题" }).click();

  await simulateKeyboardViewport(page, 100, 420);
  await page.getByRole("button", { name: "修改昵称" }).click();
  const nicknameSheet = page.getByRole("dialog", { name: "修改昵称" });
  const nicknameInput = nicknameSheet.getByRole("textbox", { name: "昵称" });
  await expect(nicknameInput).toBeFocused();
  await expect(nicknameInput).toHaveCSS("font-size", "16px");
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
