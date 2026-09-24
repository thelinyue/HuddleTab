import { expect, test, type Page } from "@playwright/test";

/** 仅替换接口，保留实际 Sheet、Portal、焦点陷阱和请求流程。 */
async function installFixture(page: Page) {
  const activity = {
    activityId: "invite-demo", name: "周末出游", baseCurrency: "CNY", status: "ACTIVE", version: "7", revision: "1",
    startDate: "2026-09-24", endDate: null, location: "杭州", inviteMode: "DIRECT_JOIN", coverPreset: 2, coverImageId: null,
    currentMemberId: "owner", currentMemberRole: "OWNER", ownerMemberId: "owner", canDelete: true,
    allowedLifecycleActions: ["END"], hasAccountingRecords: false,
    fieldPermissions: { baseCurrency: true, cover: true, endDate: true, inviteMode: true, location: true, name: true, startDate: true },
  };
  const pendingSave = Promise.withResolvers<void>();
  const saves: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const endpoint = pathname.split("/").at(-1);
    let data: unknown = [];
    if (endpoint === "session") data = { userId: "owner-user", displayName: "活动所有者", username: "owner", isSystemAdmin: false };
    else if (endpoint === "invite-demo" && route.request().method() === "PUT") {
      const input = route.request().postDataJSON();
      saves.push(input);
      if (saves.length === 1) {
        await pendingSave.promise;
        return route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "保存失败，请重试", fieldErrors: {}, details: {}, requestId: "invite-mode-test" } } });
      }
      activity.inviteMode = input.inviteMode;
      activity.version = "8";
      return route.fulfill({ json: { data: activity, warnings: [] } });
    }
    else if (endpoint === "invite-demo") data = activity;
    else if (endpoint === "activities") data = [activity];
    else if (endpoint === "members") data = [{ memberId: "owner", userId: "owner-user", displayName: "活动所有者", status: "ACTIVE", role: "OWNER" }];
    else if (endpoint === "ledger") data = { balances: [], revision: "1" };
    else if (endpoint === "capabilities") data = { available: false };
    else if (endpoint === "notifications") data = { items: [], unreadCount: 0, timeZone: "Asia/Shanghai" };
    else if (endpoint === "csrf") data = { token: "invite-test-csrf" };
    await route.fulfill({ json: { data } });
  });
  return { releaseSave: pendingSave.resolve, saves };
}

test("浮层不撑高列表，适配窄屏并独立关闭", async ({ page }, info) => {
  const fixture = await installFixture(page);
  await page.goto("/activities/invite-demo?panel=manage");
  const management = page.getByRole("dialog", { name: "活动管理", exact: true });
  const trigger = management.getByRole("button", { name: "直接加入", exact: true });
  const popover = page.getByRole("dialog", { name: "加入方式", exact: true });
  await expect(trigger).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // 先让入口进入可点击区域，再比较正文坐标，避免把正常滚动误判为布局位移。
  await trigger.scrollIntoViewIfNeeded();
  const exportButton = page.locator('.management-action-row[aria-label="导出 CSV"]');
  const before = await exportButton.boundingBox();
  const sheet = page.locator(".activity-management-overlay .form-overlay__sheet");
  const beforeSheet = await sheet.boundingBox();
  await trigger.click();
  await expect(popover).toBeVisible();
  const selected = popover.getByRole("radio", { name: /直接加入/ });
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute("aria-checked", "true");
  const bounds = (await popover.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(11);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width - 11);
  expect(bounds.y).toBeGreaterThanOrEqual(11);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height - 11);
  expect(bounds.width).toBeCloseTo(280, 0);
  expect((await exportButton.boundingBox())!.y).toBeCloseTo(before!.y, 0);
  expect((await sheet.boundingBox())!.height).toBeCloseTo(beforeSheet!.height, 0);
  expect(await popover.getByRole("radio").evaluateAll((items) => items.every((item) => item.getBoundingClientRect().height >= 56 && item.scrollWidth <= item.clientWidth))).toBe(true);
  const screenshot = info.outputPath("invite-mode-open.png");
  await page.screenshot({ path: screenshot });
  await info.attach("加入方式浮层", { path: screenshot, contentType: "image/png" });
  await page.keyboard.press("Tab");
  await expect(selected).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(selected).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(management).toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(selected).toBeFocused();
  // 顶部遮罩位于菜单之外，点击只收起当前浮层，不能穿透关闭活动管理。
  if (info.project.use.hasTouch) await page.touchscreen.tap(4, 4);
  else await page.mouse.click(4, 4);
  await expect(popover).toHaveCount(0);
  await expect(management).toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  if (info.project.use.hasTouch) await selected.tap();
  else await selected.click();
  await expect(popover).toHaveCount(0);
  expect(fixture.saves).toHaveLength(0);

  await management.getByRole("button", { name: "CNY 人民币" }).click();
  await expect(page.getByRole("radiogroup", { name: "主币种选项" })).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("radiogroup", { name: "主币种选项", includeHidden: true })).toHaveCount(0);
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");

  // 将入口放到视口底部，验证碰撞处理能向上翻转且不越界。
  await trigger.evaluate((element) => {
    const body = element.closest(".form-overlay__body")!;
    body.scrollTop = 0;
    const target = window.innerHeight - 65;
    (body as HTMLElement).style.paddingTop = `${Math.max(0, target - element.getBoundingClientRect().top)}px`;
  });
  await trigger.click();
  await expect(popover).toHaveAttribute("data-side", "top");
});

test("保存时禁止重复操作，失败可重试并恢复焦点", async ({ page }, info) => {
  const fixture = await installFixture(page);
  try {
    await page.goto("/activities/invite-demo?panel=manage");
    const management = page.getByRole("dialog", { name: "活动管理", exact: true });
    const popover = page.getByRole("dialog", { name: "加入方式", exact: true });
    await management.getByRole("button", { name: "直接加入", exact: true }).click();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => fixture.saves).toEqual([{ inviteMode: "REQUIRE_APPROVAL", version: "7" }]);
    await expect(popover.getByRole("radiogroup")).toHaveAttribute("aria-busy", "true");
    await expect(popover.getByRole("radio", { name: /需要审批/ })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await page.mouse.click(4, 4);
    await expect(popover).toBeVisible();
    await page.keyboard.press("Enter");
    expect(fixture.saves).toHaveLength(1);
    fixture.releaseSave();
    await expect(popover.getByRole("alert")).toHaveText("保存失败，请重试");
    await expect(popover.getByRole("radio", { name: /需要审批/ })).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: info.outputPath("invite-mode-error.png") });
    await popover.getByRole("radio", { name: /需要审批/ }).click();
    await expect(popover).toHaveCount(0);
    await expect(management).toBeVisible();
    await expect(management.getByRole("button", { name: "需要审批", exact: true })).toBeFocused();
    expect(fixture.saves).toHaveLength(2);
  } finally {
    fixture.releaseSave();
  }
});
