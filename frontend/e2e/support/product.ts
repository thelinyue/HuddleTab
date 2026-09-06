import { expect, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { PNG } from "playwright-core/lib/utilsBundle";

export async function installArtifactVisualRedaction(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const apply = () => {
      // 失败截图仍可用于定位布局，但账号字段和成员显示名不以可读文本进入图片。
      const selectors = [
        'input[autocomplete="username"]',
        'input[autocomplete="current-password"]',
        'input[autocomplete="new-password"]',
        ".profile-panel strong",
        ".profile-panel small",
        ".member-input-list span",
      ];
      document.querySelectorAll(selectors.join(",")).forEach((element) => {
        element.setAttribute("data-e2e-sensitive-mask", "true");
      });
    };
    if (document.documentElement) {
      apply();
      new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
    } else document.addEventListener("DOMContentLoaded", apply, { once: true });
  });
}

export function credentials(): { username: string; password: string } {
  const username = process.env.HUDDLETAB_E2E_USERNAME;
  const password = process.env.HUDDLETAB_E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("缺少 E2E 临时凭据，请通过 Phase 1E PowerShell 入口运行测试。");
  }
  return { username, password };
}

export async function assertCredentialFieldsVisuallyMasked(page: Page): Promise<void> {
  const { username, password } = credentials();
  await installArtifactVisualRedaction(page.context());
  await page.goto("/login");
  await expect(page.getByLabel("用户名")).toBeVisible();
  const fields: Array<{ label: string; locator: Locator; value: string }> = [
    { label: "用户名", locator: page.getByLabel("用户名"), value: username },
    { label: "密码", locator: page.locator('input[autocomplete="current-password"]'), value: password },
  ];
  for (const field of fields) {
    // CSP 不允许测试注入 inline <style>；在截图前同步补上 CSS 标记，避免
    // MutationObserver 尚未调度时把临时账号写入 Playwright artifact。
    await field.locator.evaluate((element) => element.setAttribute("data-e2e-sensitive-mask", "true"));
    await field.locator.fill("x".repeat(field.value.length));
    // Chromium 会在聚焦的密码框中短暂显示最后输入字符；失焦后再截图，避免
    // 浏览器原生 reveal 时序把同长度的随机密码误判为脱敏失败。
    await field.locator.evaluate((element) => (element as HTMLInputElement).blur());
    const referencePixels = await field.locator.screenshot({ animations: "disabled", caret: "hide" });
    await field.locator.fill(field.value);
    await field.locator.evaluate((element) => (element as HTMLInputElement).blur());
    const credentialPixels = await field.locator.screenshot({ animations: "disabled", caret: "hide" });
    const referenceImage = PNG.sync.read(referencePixels);
    const credentialImage = PNG.sync.read(credentialPixels);
    expect(credentialImage.width).toBe(referenceImage.width);
    expect(credentialImage.height).toBe(referenceImage.height);
    expect(Buffer.from(credentialImage.data), `${field.label}输入框的真实凭据仍改变了截图像素。`)
      .toEqual(Buffer.from(referenceImage.data));
  }
}

export async function login(page: Page): Promise<void> {
  const { username, password } = credentials();
  await installArtifactVisualRedaction(page.context());
  await page.goto("/login");
  await expect(page.getByLabel("用户名")).toBeVisible();
  await page.getByLabel("用户名").fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const loginResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/auth/login"));
  await page.getByRole("button", { name: "登录" }).click();
  const response = await loginResponse;
  if (response.status() === 429) {
    // 完整发布矩阵共用一个生产限流桶；遇到窗口限制时按 Retry-After 等待后重试，
    // 不修改服务端限流规则，也不把临时凭据写入日志或命令行。
    const retryAfter = Number.parseInt(response.headers()["retry-after"] ?? "60", 10);
    await page.waitForTimeout((Number.isFinite(retryAfter) ? Math.max(1, retryAfter) : 60) * 1000 + 500);
    await page.goto("/login");
    await page.getByLabel("用户名").fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "登录" }).click();
  }
  await expect(page.getByRole("heading", { name: "活动", exact: true })).toBeVisible();
}

export async function createActivity(page: Page, name: string): Promise<string> {
  const directCreate = page.getByRole("button", { name: "创建活动", exact: true });
  if (await directCreate.count() > 0) {
    await directCreate.first().click();
  } else {
    // v0.0.2 的非空活动列表从“新建或加入活动”进入创建子视图。
    await page.getByRole("button", { name: "新建或加入活动", exact: true }).click();
    const actionDialog = page.getByRole("dialog", { name: "新建或加入活动" });
    await actionDialog.getByRole("button", { name: /^创建活动/ }).click();
  }
  const dialog = page.getByRole("dialog", { name: "创建活动" });
  await dialog.getByLabel("活动名称").fill(name);
  await dialog.getByRole("button", { name: "创建活动", exact: true }).click();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

export async function assertActivityChrome(page: Page, expected: { themeColor: string; backgroundColor: string }): Promise<void> {
  const colors = await page.evaluate(() => ({
    themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
    workspace: getComputedStyle(document.querySelector<HTMLElement>(".workspace")!).backgroundColor,
    header: getComputedStyle(document.querySelector<HTMLElement>(".workspace-header")!).backgroundColor,
  }));
  expect(colors.themeColor).toBe(expected.themeColor);
  expect(colors.workspace).toBe(expected.backgroundColor);
  expect(colors.header).toBe(expected.backgroundColor);
}

export async function openQuickExpense(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "记一笔", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function fillQuickExpenseBasics(dialog: Locator, amount: string, title: string): Promise<void> {
  await dialog.getByLabel("金额").fill(amount);
  await dialog.getByLabel("用途").fill(title);
}

/** 快捷记账沿用 v0.0.2：需要日期、汇率或附件时显式展开“更多设置”。 */
export async function openExpenseMoreSettings(dialog: Locator): Promise<void> {
  const toggle = dialog.getByRole("button", { name: "更多设置", exact: true });
  if (await toggle.count() === 0) return;
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

export async function assertQuickExpenseGeometry(page: Page, dialog: Locator): Promise<void> {
  const viewportBottom = await page.evaluate(() => window.visualViewport
    ? window.visualViewport.offsetTop + window.visualViewport.height
    : window.innerHeight);
  // 入场动画会暂时把移动 Sheet 放在视口下方；只在最终展示位置检查粘附栏，
  // 避免把过渡中的 presentation value 当成布局错误。
  await expect.poll(
    () => dialog.evaluate((element) => element.getBoundingClientRect().bottom),
    { timeout: 1000, message: "记一笔 Sheet 入场动画未在视口内完成。" },
  ).toBeLessThanOrEqual(viewportBottom + 1);
  const metrics = await dialog.evaluate((element, expectedViewportHeight) => {
    const dialogBox = element.getBoundingClientRect();
    const amountBox = element.querySelector<HTMLElement>(".quick-expense-amount__input")?.getBoundingClientRect();
    const currencyBox = element.querySelector<HTMLElement>(".quick-expense-currency")?.getBoundingClientRect();
    const titleBox = element.querySelector<HTMLElement>(".form-overlay__header h2")?.getBoundingClientRect();
    const saveBox = element.querySelector<HTMLElement>(".quick-expense-submit")?.getBoundingClientRect();
    return {
      dialogCenter: dialogBox.left + dialogBox.width / 2,
      amountCenter: amountBox ? amountBox.left + amountBox.width / 2 : null,
      currencyRight: currencyBox ? currencyBox.right : null,
      amountLeft: amountBox?.left ?? null,
      titleCenter: titleBox ? titleBox.left + titleBox.width / 2 : null,
      saveBottom: saveBox?.bottom ?? null,
      viewportHeight: expectedViewportHeight,
    };
  }, viewportBottom);
  expect(metrics.amountCenter).not.toBeNull();
  expect(Math.abs(metrics.amountCenter! - metrics.dialogCenter), `金额输入未位于 Overlay 中轴：${JSON.stringify(metrics)}`).toBeLessThanOrEqual(2);
  expect(metrics.titleCenter).not.toBeNull();
  expect(Math.abs(metrics.titleCenter! - metrics.dialogCenter), `Header 标题未居中：${JSON.stringify(metrics)}`).toBeLessThanOrEqual(2);
  expect(metrics.currencyRight).not.toBeNull();
  expect(metrics.amountLeft).not.toBeNull();
  expect(metrics.currencyRight!).toBeLessThanOrEqual(metrics.amountLeft! + 2);
  expect(metrics.saveBottom).not.toBeNull();
  expect(metrics.saveBottom!).toBeLessThanOrEqual(metrics.viewportHeight + 1);
}

/**
 * PWA 账单编辑器只允许内容区纵向滚动。逐层检查实际布局宽度，再用横向滚轮
 * 验证浏览器不会产生可见位移；有足够内容时同时确认纵向滚动仍然可用。
 */
export async function assertExpenseEditorScrollBoundary(page: Page, editor: Locator): Promise<void> {
  const body = editor.locator(".form-overlay__body, .routed-expense-editor__body").first();
  const view = editor.locator("[data-quick-expense-view]").first();
  await expect(view).toBeVisible();
  const before = await body.evaluate((element) => {
    const bodyBox = element.getBoundingClientRect();
    const nodes = [
      element,
      element.querySelector<HTMLElement>(".quick-expense-form"),
      element.querySelector<HTMLElement>("[data-quick-expense-view]"),
      element.querySelector<HTMLElement>(".quick-member-picker, .quick-currency-list, .quick-split-list, .quick-expense-advanced"),
    ].filter((node): node is HTMLElement => Boolean(node));
    return {
      bodyLeft: bodyBox.left,
      bodyRight: bodyBox.right,
      bodyScrollLeft: element.scrollLeft,
      pageScrollX: window.scrollX,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      nodes: nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { className: node.className, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, left: box.left, right: box.right };
      }),
    };
  });
  expect(before.overflowY).toBe("auto");
  for (const node of before.nodes) {
    expect(node.scrollWidth, `编辑器节点横向溢出：${JSON.stringify(node)}`).toBeLessThanOrEqual(node.clientWidth + 1);
    expect(node.left, `编辑器节点越过内容区左边界：${JSON.stringify(node)}`).toBeGreaterThanOrEqual(before.bodyLeft - 1);
    expect(node.right, `编辑器节点越过内容区右边界：${JSON.stringify(node)}`).toBeLessThanOrEqual(before.bodyRight + 1);
  }

  const horizontal = await body.evaluate((element) => {
    const activeView = element.querySelector<HTMLElement>("[data-quick-expense-view]");
    if (!activeView) throw new Error("账单编辑器当前视图不存在。");
    const box = activeView.getBoundingClientRect();
    const startX = box.left + box.width * 0.75;
    const y = box.top + Math.min(box.height / 2, 180);
    for (const [type, clientX, buttons] of [
      ["pointerdown", startX, 1],
      ["pointermove", startX - 120, 1],
      ["pointerup", startX - 120, 0],
    ] as const) {
      activeView.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY: y, buttons, pointerId: 1, pointerType: "touch" }));
    }
    element.scrollLeft = 240;
    return { bodyScrollLeft: element.scrollLeft, pageScrollX: window.scrollX, viewLeft: activeView.getBoundingClientRect().left };
  });
  expect(horizontal.bodyScrollLeft).toBe(before.bodyScrollLeft);
  expect(horizontal.pageScrollX).toBe(before.pageScrollX);
  expect(horizontal.viewLeft).toBe(before.nodes[2]?.left);

  if (before.scrollHeight > before.clientHeight + 1) {
    const scrollTop = await body.evaluate((element) => {
      element.scrollTop += 160;
      return element.scrollTop;
    });
    expect(scrollTop).toBeGreaterThan(0);
  }
}

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, `页面横向溢出：${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.clientWidth);
}

export async function saveChromiumSuccessScreenshot(page: Page, testInfo: TestInfo): Promise<void> {
  if (!testInfo.project.name.startsWith("chromium-")) return;
  const path = testInfo.outputPath("core-success.png");
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach("Chromium 核心流程成功态", { path, contentType: "image/png" });
}
