import { expect, test, type Page } from "@playwright/test";
import { login, assertNoHorizontalOverflow } from "./support/product";

async function mutate(page: Page, path: string, body: unknown, method = "POST") {
  return page.evaluate(async ({ path, body, method }) => {
    const csrf = await (await fetch("/api/auth/csrf")).json();
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.data.token }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
    return response.status === 204 ? null : (await response.json()).data;
  }, { path, body, method });
}

async function expectMobileConfirmationFits(page: Page) {
  const confirmation = page.getByRole("alertdialog");
  const geometry = await confirmation.evaluate((dialog) => {
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>(".confirm-dialog__actions button")];
    const scrim = dialog.parentElement?.querySelector(".confirm-overlay__scrim");
    return {
      portalParent: dialog.parentElement?.parentElement === document.body,
      buttonsVisible: buttons.length === 2 && buttons.every((button) => button.getBoundingClientRect().bottom <= window.innerHeight - 34),
      bottomCovered: document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1) === scrim,
    };
  });
  expect(geometry).toEqual({ portalParent: true, buttonsVisible: true, bottomCovered: true });
}

test("活动管理保存并关闭后，系统返回直达活动列表", async ({ page }) => {
  await login(page);
  const activity = await mutate(page, "/api/activities", { name: "管理返回验收", baseCurrency: "CNY", startDate: "2026-09-21" });
  let version = activity.version;
  try {
    await page.goto("/activities");
    await page.locator(".activity-list-item").filter({ hasText: "管理返回验收" }).click();
    await page.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("link", { name: "活动信息" }).click();
    await expect(page.getByRole("dialog", { name: "活动管理" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog", { name: "活动管理" })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/activities/${activity.activityId}$`));

    await page.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("link", { name: "活动信息" }).click();
    const location = page.getByRole("textbox", { name: "地点" });
    await location.fill("苏州");
    const saveResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith(`/api/activities/${activity.activityId}`));
    await location.blur();
    version = (await (await saveResponse).json()).data.version;
    await page.getByRole("button", { name: "关闭活动管理" }).click();
    await expect(page.getByRole("dialog", { name: "活动管理" })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/activities$/);
  } finally {
    await mutate(page, `/api/activities/${activity.activityId}`, { version }, "DELETE");
  }
});

test("活动首页加载与读取失败不显示虚假的已结清", async ({ page }) => {
  await login(page);
  const activity = await mutate(page, "/api/activities", { name: "加载状态验收", baseCurrency: "CNY", startDate: "2026-09-21" });
  const listRoute = "**/api/activities?view=current";
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  try {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.route(listRoute, async (route) => { await pending; await route.continue(); });
    await page.goto("/activities");
    await expect(page.getByRole("status").filter({ hasText: "正在读取活动" })).toBeAttached();
    await expect(page.locator(".activity-list-item--skeleton")).toHaveCount(2);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: "../artifacts/permanent-activity/home-loading-320.png", fullPage: true });
    await page.route(`**/api/activities/${activity.activityId}/ledger`, (route) => route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "余额读取失败" } } }));
    release();
    await expect(page.locator("a.activity-list-item")).toContainText("余额暂不可用");
    await expect(page.locator(".home-summary:not(.home-summary--skeleton)")).toContainText("暂不可用");
    await expect(page.getByText("已结清", { exact: true })).toHaveCount(0);
    await page.unroute(listRoute);
    await page.route(listRoute, (route) => route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "活动列表读取失败" } } }));
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("活动列表读取失败");
    await expect(page.getByRole("group", { name: "活动状态筛选" })).toBeVisible();
    await expect(page.locator(".activity-list-item")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: "../artifacts/permanent-activity/home-error-320.png", fullPage: true });
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await mutate(page, `/api/activities/${activity.activityId}`, { version: activity.version }, "DELETE");
  }
});

test("活动首页四状态、返回、永久删除与响应式布局", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await login(page);
  const activities: Array<{ activityId: string; version: string }> = [];
  try {
    for (const [name, status, amount, payable] of [
      ["周末杭州游", "ACTIVE", "12800", true],
      ["中秋聚会", "ENDED", "25600", false],
      ["去年旅行", "ARCHIVED", "0", false],
    ] as const) {
      let activity = await mutate(page, "/api/activities", { name, baseCurrency: "CNY", startDate: "2026-09-21", endDate: "2026-09-23", coverPreset: activities.length + 1 });
      activities.push(activity);
      if (amount !== "0") {
        const guest = await mutate(page, `/api/activities/${activity.activityId}/members/guests`, { displayName: "同行人" });
        await mutate(page, `/api/activities/${activity.activityId}/expenses`, {
          clientMutationId: crypto.randomUUID(), title: "共同消费", category: "FOOD", occurredAt: "2026-09-22T12:00:00Z",
          originalCurrency: "CNY", originalAmountMinor: amount, exchangeRateKind: "IDENTITY", exchangeRate: "1",
          payments: [{ memberId: payable ? guest.memberId : activity.ownerMemberId, amountMinor: amount }],
          split: { mode: "EQUAL", members: [payable ? activity.ownerMemberId : guest.memberId] },
        });
      }
      for (const action of status === "ACTIVE" ? [] : status === "ENDED" ? ["END"] : ["END", "ARCHIVE"]) {
        activity = await mutate(page, `/api/activities/${activity.activityId}/lifecycle`, { action, version: activity.version });
        activities[activities.length - 1] = activity;
      }
    }
    await page.goto("/activities");
    await expect(page.locator(".activity-list-item")).toHaveCount(3);
    const dismissPush = page.getByRole("button", { name: "稍后再说", exact: true });
    if (await dismissPush.isVisible()) await dismissPush.click();
    const filters = page.getByRole("group", { name: "活动状态筛选" });
    await expect(filters.getByRole("button", { name: "全部", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".home-summary")).toContainText("128.00");
    const summary = await page.locator(".home-summary").textContent();
    for (const [label, value, name] of [["进行中", "active", "周末杭州游"], ["已结束", "ended", "中秋聚会"], ["已归档", "archived", "去年旅行"]]) {
      await filters.getByRole("button", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`status=${value}`));
      await expect(page.locator(".activity-list-item")).toHaveCount(1);
      await expect(page.locator(".activity-list-item")).toContainText(name);
      expect(await page.locator(".home-summary").textContent()).toBe(summary);
    }
    await page.reload();
    await expect(filters.getByRole("button", { name: "已归档", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.locator(".activity-list-item").click();
    await page.goBack();
    await expect(page).toHaveURL(/status=archived/);
    await filters.getByRole("button", { name: "全部", exact: true }).click();
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await assertNoHorizontalOverflow(page);
      const layout = await filters.evaluate((element) => {
        const buttons = [...element.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
        return { left: buttons[0].left - element.getBoundingClientRect().left, gap: buttons[1].left - buttons[0].right, height: buttons[0].height, last: buttons[3].right - buttons[0].left };
      });
      expect(layout.left).toBe(0);
      expect(layout.gap).toBe(4);
      expect(layout.height).toBeGreaterThanOrEqual(44);
      expect(layout.last).toBeLessThan(280);
      await page.locator(".activity-list-item").last().scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const last = await page.locator(".activity-list-item").last().boundingBox();
      const add = await page.getByRole("button", { name: "新建或加入活动", exact: true }).boundingBox();
      expect(last!.y + last!.height).toBeLessThanOrEqual(add!.y);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `../artifacts/permanent-activity/home-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.classList.add("dark"); });
    await page.screenshot({ path: "../artifacts/permanent-activity/home-dark-390.png", fullPage: true });
    await page.evaluate(() => { document.documentElement.classList.remove("dark"); });
    const large = await mutate(page, "/api/activities", { name: "一次名称很长的跨国旅行与朋友共同消费记录需要完整识别活动", baseCurrency: "USD", startDate: "2026-09-21", coverPreset: 5 });
    activities.push(large);
    const guest = await mutate(page, `/api/activities/${large.activityId}/members/guests`, { displayName: "同行人" });
    await mutate(page, `/api/activities/${large.activityId}/expenses`, {
      clientMutationId: crypto.randomUUID(), title: "大金额排版验收", category: "OTHER", occurredAt: "2026-09-22T12:00:00Z",
      originalCurrency: "USD", originalAmountMinor: "99999999999999", exchangeRateKind: "IDENTITY", exchangeRate: "1",
      payments: [{ memberId: large.ownerMemberId, amountMinor: "99999999999999" }], split: { mode: "EQUAL", members: [guest.memberId] },
    });
    await page.goto("/activities");
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(page.locator(".home-summary")).toHaveCount(2);
    await page.goto("/activities?currency=USD");
    await expect(page.locator(".activity-list-item").filter({ hasText: large.name })).toContainText("999,999,999,999.99");
    await assertNoHorizontalOverflow(page);
    for (const money of await page.locator(".activities-page .money").all()) {
      expect(await money.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
    }
    await page.screenshot({ path: "../artifacts/permanent-activity/home-multicurrency-320.png", fullPage: true });
    await mutate(page, `/api/activities/${large.activityId}`, { version: large.version }, "DELETE");
    activities.pop();
    await page.reload();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await filters.getByRole("button", { name: "全部", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(filters.getByRole("button", { name: "进行中", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".activity-list-item")).toHaveCount(1);
    await page.goto(`/activities/${activities[1].activityId}?panel=manage`);
    await page.locator("html").evaluate((root) => root.style.setProperty("--safe-area-bottom", "34px"));
    await page.getByRole("button", { name: /^归档活动/ }).click();
    await expectMobileConfirmationFits(page);
    await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
    await page.goto(`/activities/${activities[0].activityId}?panel=manage`);
    await page.locator("html").evaluate((root) => root.style.setProperty("--safe-area-bottom", "34px"));
    await page.getByRole("button", { name: /^删除活动/ }).click();
    let confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("对所有成员生效，删除后无法恢复");
    await expectMobileConfirmationFits(page);
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "活动管理" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^删除活动/ })).toBeFocused();
    await page.getByRole("button", { name: /^删除活动/ }).click();
    confirmation = page.getByRole("alertdialog");
    const response = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes(activities[0].activityId));
    await confirmation.getByRole("button", { name: "永久删除", exact: true }).click();
    expect((await response).status()).toBe(204);
    activities.shift();
    await expect(page).toHaveURL(/\/activities$/);
    await expect(page.getByRole("button", { name: "已删除活动" })).toHaveCount(0);
    await filters.getByRole("button", { name: "进行中", exact: true }).click();
    await expect(page.getByText("暂无进行中的活动")).toBeVisible();
    await page.getByRole("button", { name: "查看全部", exact: true }).click();
    await expect(page.locator(".activity-list-item")).toHaveCount(2);
  } finally {
    for (const activity of activities) await mutate(page, `/api/activities/${activity.activityId}`, { version: activity.version }, "DELETE");
  }
  await testInfo.attach("移动端布局", { path: "../artifacts/permanent-activity/home-390.png", contentType: "image/png" });
});
