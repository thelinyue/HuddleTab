import { expect, test, type Page } from "@playwright/test";

/** 保留实际路由、查询和 Sheet 切换；只替换接口，控制加载及失败时机。 */
async function installFixture(page: Page, memberCount = 0) {
  const activity = {
    activityId: "transfer-demo", name: "北京之行", baseCurrency: "CNY", status: "ACTIVE", version: "7", revision: "1",
    startDate: "2026-09-24", endDate: null, location: "北京", inviteMode: "DIRECT_JOIN", coverPreset: 2, coverImageId: null,
    currentMemberId: "owner", currentMemberRole: "OWNER", ownerMemberId: "owner", canDelete: true,
    allowedLifecycleActions: ["END"], hasAccountingRecords: false,
    fieldPermissions: { baseCurrency: true, cover: true, endDate: true, inviteMode: true, location: true, name: true, startDate: true },
  };
  const common = { status: "ACTIVE", role: "MEMBER", avatarPreset: 1, avatarImageId: null };
  const members = [
    { ...common, memberId: "owner", userId: "owner-user", displayName: "活动所有者", role: "OWNER" },
    { ...common, memberId: "guest", userId: null, displayName: "临时成员" },
    { ...common, memberId: "inactive", userId: "inactive-user", displayName: "已退出成员", status: "LEFT" },
    ...Array.from({ length: memberCount }, (_, index) => ({ ...common, memberId: `member-${index + 1}`, userId: `user-${index + 1}`, displayName: `同行成员 ${index + 1}` })),
  ];
  const membersReady = Promise.withResolvers<void>();
  const transferReady = Promise.withResolvers<void>();
  const transfers: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    const endpoint = pathname.split("/").at(-1);
    let data: unknown = [];
    if (endpoint === "session") data = { userId: "owner-user", displayName: "活动所有者", username: "owner", isSystemAdmin: false };
    else if (endpoint === "transfer-demo") data = activity;
    else if (endpoint === "activities") data = [activity];
    else if (endpoint === "members") { await membersReady.promise; data = members; }
    else if (endpoint === "ledger") data = { balances: [], revision: "1" };
    else if (endpoint === "capabilities") data = { available: false };
    else if (endpoint === "notifications") data = { items: [], unreadCount: 0, timeZone: "Asia/Shanghai" };
    else if (endpoint === "csrf") data = { token: "transfer-test-csrf" };
    else if (endpoint === "ownership") {
      transfers.push(route.request().postDataJSON());
      await transferReady.promise;
      return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT", message: "活动版本已变化", fieldErrors: {}, details: {}, requestId: "transfer-layout" } } });
    }
    await route.fulfill({ json: { data } });
  });
  return { releaseMembers: membersReady.resolve, releaseTransfer: transferReady.resolve, transfers };
}

async function openTransfer(page: Page) {
  await page.goto("/activities/transfer-demo?panel=manage");
  await page.getByRole("dialog", { name: "活动管理", exact: true }).getByRole("button", { name: /^转让所有权/ }).click();
  await expect(page.getByRole("dialog", { name: "转让所有权", exact: true })).toBeVisible();
}

async function assertLayout(page: Page) {
  const expectedHeight = page.viewportSize()!.width < 640 ? 50 : 44;
  const actions = page.locator(".activity-management-overlay--transfer .management-expansion__actions");
  // 必须检查实际上限：仅验证 min-height 或可见性无法捕获 WebKit 的网格拉伸。
  await expect.poll(() => actions.locator(".button").evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().height)))).toEqual([expectedHeight, expectedHeight]);
  const geometry = await actions.evaluate((element) => {
    const buttons = [...element.querySelectorAll<HTMLElement>(".button")].map((button) => button.getBoundingClientRect());
    const sheet = element.closest(".form-overlay__sheet")!;
    const body = sheet.querySelector<HTMLElement>(".form-overlay__body")!;
    return {
      buttonTops: buttons.map((button) => button.top),
      gap: buttons[1].left - buttons[0].right,
      widthRatio: buttons[1].width / buttons[0].width,
      fits: buttons.every((button) => button.left >= 0 && button.right <= window.innerWidth),
      overflow: Math.max(document.documentElement.scrollWidth - window.innerWidth, body.scrollWidth - body.clientWidth),
      sheetHeight: sheet.getBoundingClientRect().height,
    };
  });
  expect(geometry.buttonTops[0]).toBeCloseTo(geometry.buttonTops[1], 0);
  expect(geometry.fits).toBe(true);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  if (page.viewportSize()!.width < 640) {
    expect(geometry.gap).toBeCloseTo(10, 0);
    expect(geometry.widthRatio).toBeCloseTo(1.5, 1);
  }
  return geometry;
}

test("加载结束后的空状态自然收起，按钮保持正常高度", async ({ page }, info) => {
  const fixture = await installFixture(page);
  try {
    await openTransfer(page);
    const dialog = page.getByRole("dialog", { name: "转让所有权", exact: true });
    await expect(dialog.getByRole("status")).toHaveText("正在读取可转让成员…");
    await expect(dialog.getByRole("button", { name: "确认转让" })).toBeDisabled();
    await assertLayout(page);
    fixture.releaseMembers();
    await expect(dialog.getByText("暂无可转让的已绑定账号成员。")).toBeVisible();
    await expect(dialog.getByRole("radiogroup")).toHaveCount(0);
    expect((await assertLayout(page)).sheetHeight).toBeLessThan(320);
    await expect(dialog.getByRole("heading", { name: "选择新的活动所有者" })).toBeVisible();
    await page.screenshot({ path: info.outputPath("transfer-empty.png") });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("button", { name: /^转让所有权/ })).toBeFocused();
    await page.getByRole("button", { name: /^转让所有权/ }).click();
    expect((await assertLayout(page)).sheetHeight).toBeLessThan(320);
    expect(fixture.transfers).toHaveLength(0);
  } finally {
    fixture.releaseMembers();
  }
});

test("选择账号成员后提交失败，保留选择和紧凑按钮", async ({ page }, info) => {
  const fixture = await installFixture(page, 1);
  fixture.releaseMembers();
  try {
    await openTransfer(page);
    const dialog = page.getByRole("dialog", { name: "转让所有权", exact: true });
    const confirm = dialog.getByRole("button", { name: "确认转让" });
    const candidates = dialog.getByRole("radio");
    await expect(candidates).toHaveCount(1);
    await expect(confirm).toBeDisabled();
    await candidates.click();
    await expect(candidates).toHaveAttribute("aria-checked", "true");
    await expect(confirm).toBeEnabled();
    await assertLayout(page);
    await confirm.click();
    await expect.poll(() => fixture.transfers).toEqual([{ newOwnerMemberId: "member-1", version: "7" }]);
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
    await assertLayout(page);
    fixture.releaseTransfer();
    await expect(dialog.getByRole("alert")).toHaveText("活动版本已变化");
    await expect(candidates).toHaveAttribute("aria-checked", "true");
    await expect(confirm).toBeEnabled();
    await assertLayout(page);
    await page.screenshot({ path: info.outputPath("transfer-error.png") });
    await dialog.getByRole("button", { name: "返回活动管理" }).click();
    await expect(page.getByRole("button", { name: /^转让所有权/ })).toBeFocused();
  } finally {
    fixture.releaseTransfer();
  }
});

test("长成员列表在正文滚动，底部按钮避开安全区", async ({ page }, info) => {
  const fixture = await installFixture(page, 30);
  fixture.releaseMembers();
  await openTransfer(page);
  const mobile = page.viewportSize()!.width < 640;
  if (mobile) await page.addStyleTag({ content: ":root { --safe-area-bottom: 34px; }" });
  const dialog = page.getByRole("dialog", { name: "转让所有权", exact: true });
  await expect(dialog.getByRole("radio")).toHaveCount(30);
  const header = dialog.locator(".form-overlay__header");
  const headerTop = (await header.boundingBox())!.y;
  await dialog.getByRole("radio", { name: /同行成员 30$/ }).click();
  const confirm = dialog.getByRole("button", { name: "确认转让" });
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeEnabled();
  await assertLayout(page);
  const body = dialog.locator(".form-overlay__body");
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight && element.scrollTop > 0)).toBe(true);
  expect((await header.boundingBox())!.y).toBeCloseTo(headerTop, 0);
  const buttonBounds = (await confirm.boundingBox())!;
  const bodyBounds = (await body.boundingBox())!;
  const sheetBounds = (await dialog.boundingBox())!;
  expect(buttonBounds.y).toBeGreaterThanOrEqual(bodyBounds.y);
  expect(buttonBounds.y + buttonBounds.height).toBeLessThanOrEqual(bodyBounds.y + bodyBounds.height + 1);
  expect(buttonBounds.y + buttonBounds.height).toBeLessThanOrEqual(sheetBounds.y + sheetBounds.height - (mobile ? 34 : 0));
  expect(sheetBounds.y + sheetBounds.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  await page.screenshot({ path: info.outputPath("transfer-long-list.png") });
});
