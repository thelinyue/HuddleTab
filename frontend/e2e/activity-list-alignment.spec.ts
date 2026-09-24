import { expect, test, type Page } from "@playwright/test";

/** 模拟截图中的活动和余额，仅验证列表展示，不向实际服务写入账务数据。 */
async function installFixture(page: Page, delayed = false) {
  const common = { currentMemberId: "owner", ownerMemberId: "owner", currentMemberRole: "OWNER", baseCurrency: "CNY", startDate: "2026-09-19", endDate: null as string | null, status: "ACTIVE", version: "1", revision: "1", coverImageId: null };
  const activities = [
    { ...common, activityId: "receivable", name: "北京之行", endDate: "2026-09-20", coverPreset: 2 },
    { ...common, activityId: "settled", name: "测试", coverPreset: 3 },
    { ...common, activityId: "payable", name: "123", startDate: "2026-09-21", coverPreset: 5 },
    { ...common, activityId: "ended", name: "鸡公煲", endDate: "2026-09-19", status: "ENDED", coverPreset: 5 },
  ];
  const amounts: Record<string, string> = { receivable: "197589", settled: "0", payable: "-12800", ended: "0", large: "99999999999999" };
  let releaseList!: () => void;
  let releaseLedgers!: () => void;
  const listReady = new Promise<void>((resolve) => { releaseList = resolve; });
  const ledgersReady = new Promise<void>((resolve) => { releaseLedgers = resolve; });
  if (!delayed) { releaseList(); releaseLedgers(); }
  await page.route("**/api/**", async (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    const endpoint = parts.at(-1);
    let data: unknown = [];
    if (endpoint === "session") data = { userId: "alignment-user", displayName: "测试用户", username: "alignment", isSystemAdmin: false };
    else if (endpoint === "notifications") data = { items: [], unreadCount: 0, timeZone: "Asia/Shanghai" };
    else if (endpoint === "activities") { await listReady; data = activities; }
    else if (endpoint === "ledger") {
      await ledgersReady;
      const id = parts.at(-2)!;
      if (delayed && id === "receivable") {
        await route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "余额读取失败" } } });
        return;
      }
      data = { balances: [{ memberId: "owner", netMinor: amounts[id] }] };
    }
    await route.fulfill({ json: { data } });
  });
  return { activities, releaseList, releaseLedgers };
}

/** 直接检查可见元素的几何关系，防止字段再次跌入下一行或遮挡相邻列。 */
async function expectAlignedRows(page: Page) {
  const rows = await page.locator(".activity-list-item").evaluateAll((elements) => elements.map((row) => {
    const rect = row.getBoundingClientRect();
    const boxes = ["img, .activity-skeleton-block--cover", ".activity-list-item__content", ".activity-list-item__balance", "svg"].map((selector) => {
      const box = row.querySelector(selector)!.getBoundingClientRect();
      return { left: box.left, right: box.right, centerY: box.y + box.height / 2, width: box.width };
    });
    return { left: rect.left, right: rect.right, height: rect.height, centerY: rect.y + rect.height / 2, boxes };
  }));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.height).toBeGreaterThanOrEqual(80);
    expect(row.boxes[0].width).toBe(48);
    expect(row.boxes[3].width).toBe(16);
    for (const [index, box] of row.boxes.entries()) {
      expect(Math.abs(box.centerY - row.centerY)).toBeLessThanOrEqual(1);
      expect(box.left).toBeGreaterThanOrEqual(row.left);
      expect(box.right).toBeLessThanOrEqual(row.right);
      if (index) expect(box.left - row.boxes[index - 1].right).toBeGreaterThanOrEqual(4);
    }
    expect(Math.abs(row.boxes[3].left - rows[0].boxes[3].left)).toBeLessThanOrEqual(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  for (const money of await page.locator(".activity-list-item .money").all()) {
    expect(await money.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  }
}

async function captureList(page: Page, path: string) {
  // 短屏可滚到列表末尾，确保最后一行能完整露出在悬浮操作按钮上方。
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = (await page.locator(".activity-list-item").last().boundingBox())!;
  const add = (await page.getByRole("button", { name: "新建或加入活动", exact: true }).boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(add.y);
  await page.screenshot({ path, fullPage: true });
}

test("活动列表四列居中，长名称和大金额不挤压相邻字段", async ({ page }, info) => {
  const fixture = await installFixture(page);
  await page.goto("/activities");
  await expect(page.locator("a.activity-list-item")).toHaveCount(4);
  await expect(page.locator('a[href="/activities/receivable"] .activity-list-item__balance')).toHaveText("应收¥1,975.89");
  await expect(page.locator('a[href="/activities/payable"] .activity-list-item__balance')).toHaveText("应付¥128.00");
  await expect(page.locator('a[href="/activities/settled"] .activity-list-item__balance')).toHaveText("已结清");
  const dismiss = page.getByRole("button", { name: "稍后再说", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await expectAlignedRows(page);
  await captureList(page, `../artifacts/activity-list-alignment/${info.project.name}.png`);

  fixture.activities.push({ ...fixture.activities[0], activityId: "large", name: "一次名称很长的跨国旅行与朋友共同消费记录需要完整识别活动", endDate: null });
  await page.reload();
  const large = page.locator('a[href="/activities/large"]');
  await expect(large).toContainText("999,999,999,999.99");
  await expectAlignedRows(page);
  const title = large.locator("strong");
  expect(await title.evaluate((element) => element.getBoundingClientRect().height <= Number.parseFloat(getComputedStyle(element).lineHeight) * 2 + 1)).toBeTruthy();
  await captureList(page, `../artifacts/activity-list-alignment/${info.project.name}-long.png`);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expectAlignedRows(page);
  await captureList(page, `../artifacts/activity-list-alignment/${info.project.name}-dark.png`);
  await page.getByRole("button", { name: "全部", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "进行中", exact: true })).toBeFocused();
  await page.locator('a[href="/activities/settled"]').click();
  await expect(page).toHaveURL(/\/activities\/settled$/);
});

test("活动列表骨架和余额加载、失败状态保持居中", async ({ page }, info) => {
  const fixture = await installFixture(page, true);
  try {
    await page.goto("/activities");
    await expect(page.locator(".activity-list-item--skeleton")).toHaveCount(2);
    await expectAlignedRows(page);
    fixture.releaseList();
    await expect(page.locator("a.activity-list-item .activity-balance-skeleton")).toHaveCount(4);
    await expect(page.getByText("已结清", { exact: true })).toHaveCount(0);
    await expectAlignedRows(page);
    fixture.releaseLedgers();
    const unavailable = page.locator('a[href="/activities/receivable"]');
    await expect(unavailable).toContainText("余额暂不可用");
    await expect(unavailable).not.toContainText("已结清");
    await expectAlignedRows(page);
    await captureList(page, `../artifacts/activity-list-alignment/${info.project.name}-error.png`);
  } finally {
    fixture.releaseList();
    fixture.releaseLedgers();
    await page.unrouteAll({ behavior: "wait" });
  }
});
