import { expect, test, type Page } from "@playwright/test";

async function installFixture(page: Page) {
  const common = { currentMemberId: "owner", ownerMemberId: "owner", currentMemberRole: "OWNER", startDate: "2026-09-21", endDate: "2026-09-23", version: "1", revision: "1", coverImageId: null };
  const activities = [
    { ...common, activityId: "cny", name: "周末杭州游", baseCurrency: "CNY", status: "ACTIVE", coverPreset: 1 },
    { ...common, activityId: "usd", name: "一次名称很长的跨国旅行与朋友共同消费记录需要完整识别活动", baseCurrency: "USD", status: "ACTIVE", coverPreset: 5 },
    { ...common, activityId: "usd-archived", name: "去年美国旅行", baseCurrency: "USD", status: "ARCHIVED", coverPreset: 7 },
  ];
  const reads: string[] = [];
  const amounts = { usd: "8000" };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    reads.push(url.pathname);
    const endpoint = url.pathname.split("/").at(-1);
    let data: unknown = [];
    if (endpoint === "session") data = { userId: "currency-user", displayName: "测试用户", username: "currency-demo", isSystemAdmin: false };
    else if (endpoint === "activities") data = activities;
    else if (endpoint === "notifications") data = { items: [], unreadCount: 0, timeZone: "Asia/Shanghai" };
    else if (endpoint === "ledger") data = { balances: [{ memberId: "owner", netMinor: url.pathname.includes("/cny/") ? "-12800" : url.pathname.includes("/usd/") ? amounts.usd : "3200" }] };
    await route.fulfill({ json: { data } });
  });
  return { activities, reads, amounts };
}

test("币种滑动联动列表、状态、刷新返回和窄屏布局", async ({ page, browserName }, info) => {
  const fixture = await installFixture(page);
  await page.goto("/activities?keep=yes");
  const dismiss = page.getByRole("button", { name: "稍后再说", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  const track = page.locator(".activity-currency-summary__track");
  await expect(page.locator("a.activity-list-item")).toHaveCount(1);
  await expect(page.locator("a.activity-list-item")).toContainText("周末杭州游");
  const previous = page.getByRole("button", { name: "上一个币种" });
  const next = page.getByRole("button", { name: "下一个币种" });
  const position = page.locator('.activity-currency-summary__slide[aria-hidden="false"] .activity-currency-summary__position');
  await expect(position).toHaveText("1/2");
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(position).toHaveText("2/2");
  await expect(next).toBeDisabled();
  await expect(page.locator("a.activity-list-item")).toHaveCount(2);
  await previous.click();
  await expect(position).toHaveText("1/2");
  await expect(page.locator("a.activity-list-item")).toHaveCount(1);
  for (const arrow of [previous, next]) {
    const box = (await arrow.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  const reads = fixture.reads.filter((path) => path.endsWith("/activities") || path.endsWith("/ledger")).length;
  const bounds = (await track.boundingBox())!;
  if (browserName === "chromium" && info.project.use.isMobile) {
    // CDP 真实触摸输入触发原生滚动，覆盖 touchcancel/惯性吸附，而非直接修改组件状态。
    const cdp = await page.context().newCDPSession(page);
    const y = bounds.y + bounds.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bounds.x + bounds.width * .85, y }] });
    for (let step = 1; step <= 10; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: bounds.x + bounds.width * (.85 - .07 * step), y }] });
      await page.waitForTimeout(20);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => track.evaluate((element) => Math.abs(element.scrollLeft - (element.children[1] as HTMLElement).offsetLeft))).toBeLessThan(2);
    await cdp.detach();
  } else if (browserName === "chromium") {
    await track.hover();
    await page.mouse.wheel(bounds.width, 0);
  } else {
    // Mobile WebKit 的自动化接口不支持触摸拖拽或滚轮；验证原生滚动吸附，触摸输入由 Chromium 覆盖。
    await track.evaluate((element) => element.scrollTo({ left: element.clientWidth * .8 }));
  }
  await expect(page.locator('.activity-currency-summary__slide[aria-hidden="false"]')).toHaveAttribute("aria-label", "USD 跨活动账务摘要");
  await expect(page).toHaveURL(/keep=yes&currency=USD/);
  await expect(position).toHaveText("2/2");
  await expect(page.locator("a.activity-list-item")).toHaveCount(2);
  await expect.poll(() => track.evaluate((element) => Math.abs(element.scrollLeft - (element.children[1] as HTMLElement).offsetLeft))).toBeLessThan(2);
  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await expect(page.locator("a.activity-list-item")).toHaveCount(1);
  await expect(page.locator("a.activity-list-item")).toContainText("去年美国旅行");
  await expect(page.locator(".activity-currency-summary__slide[aria-hidden=false]")).toContainText("US$112.00");
  expect(fixture.reads.filter((path) => path.endsWith("/activities") || path.endsWith("/ledger")).length).toBe(reads);
  await page.reload();
  await expect(page.locator('.activity-currency-summary__slide[aria-hidden="false"]')).toHaveAttribute("aria-label", "USD 跨活动账务摘要");
  await expect.poll(() => track.evaluate((element) => Math.abs(element.scrollLeft - (element.children[1] as HTMLElement).offsetLeft))).toBeLessThan(2);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ ...viewport, width: viewport.width + 20 });
  await expect.poll(() => track.evaluate((element) => Math.abs(element.scrollLeft - (element.children[1] as HTMLElement).offsetLeft))).toBeLessThan(2);
  await page.setViewportSize(viewport);
  await page.getByRole("link", { name: "我的", exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/currency=USD&status=archived/);
  await expect(page.locator("a.activity-list-item")).toContainText("去年美国旅行");
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.locator("a.activity-list-item")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  for (const money of await page.locator(".money").all()) {
    expect(await money.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  }
  await page.screenshot({ path: `../artifacts/activity-currency/${info.project.name}.png`, fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await track.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("a.activity-list-item")).toHaveCount(1);
  await expect(page.locator("a.activity-list-item")).toContainText("周末杭州游");
  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await expect(page.getByText("暂无已归档的活动")).toBeVisible();
  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await expect(page.locator("a.activity-list-item")).toContainText("周末杭州游");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: `../artifacts/activity-currency/${info.project.name}-dark.png`, fullPage: true });
  fixture.amounts.usd = "99999999999999";
  await page.goto("/activities?currency=USD");
  await expect(page.locator(".activity-currency-summary__slide[aria-hidden=false]")).toContainText("1,000,000,000,031.99");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  for (const money of await page.locator(".money").all()) {
    expect(await money.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  }
  await page.screenshot({ path: `../artifacts/activity-currency/${info.project.name}-large.png`, fullPage: true });
  fixture.activities.splice(1);
  await page.goto("/activities?currency=USD");
  await expect(page.locator("a.activity-list-item")).toContainText("周末杭州游");
  await expect(track).not.toHaveAttribute("tabindex");
  await expect(page.locator(".activity-currency-summary button")).toHaveCount(0);
  await expect(position).toHaveCount(0);
});
