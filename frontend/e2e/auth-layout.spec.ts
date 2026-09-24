import { expect, test, type Locator, type Page } from "@playwright/test";

/** 夹具只模拟认证和邀请边界，响应仍经过真实查询、表单与路由流程。 */
async function installFixture(page: Page) {
  const state = {
    signedIn: false,
    policy: "OPEN",
    policyError: false,
    invitationError: false,
    authError: false,
    authWait: undefined as Promise<void> | undefined,
    invitationWait: undefined as Promise<void> | undefined,
    authCalls: 0,
    joinCalls: 0,
    requestStatus: "PENDING",
    preview: {
      activityId: "activity-1", activityName: "周末杭州游", activeMemberCount: 4,
      expiresAt: "2026-12-31T15:59:59Z", kind: "LINK", purpose: "JOIN",
      guestDisplayName: null as string | null, guestMemberId: null as string | null,
    },
  };
  const session = { userId: "auth-user", username: "traveler", displayName: "小林", isSystemAdmin: false };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const fail = (status: number, message: string) => route.fulfill({ status, json: { error: { code: "VALIDATION_ERROR", message, fieldErrors: {}, details: {}, requestId: "auth-layout" } } });
    let data: unknown = {};
    if (path === "/api/auth/session") {
      if (!state.signedIn) { await fail(401, "请先登录。"); return; }
      data = session;
    } else if (path === "/api/auth/registration-policy") {
      if (state.policyError) { await fail(503, "暂时无法读取注册策略，请稍后重试。"); return; }
      data = { policy: state.policy };
    } else if (path === "/api/auth/csrf") data = { token: "test-csrf" };
    else if (path === "/api/auth/login" || path === "/api/auth/register") {
      state.authCalls += 1;
      await state.authWait;
      if (state.authError) { await fail(422, "这个用户名已被使用，请更换后重试。"); return; }
      state.signedIn = true;
      data = session;
    } else if (path === "/api/invitations/mobile-invite") {
      await state.invitationWait;
      if (state.invitationError) { await fail(410, "邀请已过期，请联系活动所有者获取新的邀请链接。"); return; }
      data = state.preview;
    } else if (path === "/api/invitations/mobile-invite/join") {
      state.joinCalls += 1;
      data = { activityId: "activity-1", requestId: "request-1", memberId: null, revision: "1", status: "PENDING_APPROVAL" };
    } else if (path === "/api/join-requests/request-1") {
      data = { activityId: "activity-1", requestId: "request-1", status: state.requestStatus };
    } else if (path === "/api/me/push-settings") data = { enabled: false };
    await route.fulfill({ json: { data } });
  });
  return state;
}

async function assertNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

async function assertPrimary(page: Page, button: Locator, firstScreen = true) {
  const box = (await button.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.height).toBeGreaterThanOrEqual(48);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  if (firstScreen) {
    // 原生滚动按设备像素取整，允许 CSS 边界的小数像素舍入。
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  }
}

const screens = [
  { path: "/login", title: "登录伙记", action: "登录", role: "button", name: "login" },
  { path: "/register", title: "创建账号", action: "注册", role: "button", name: "register" },
  { path: "/join/mobile-invite", title: "周末杭州游", action: "注册并加入", role: "link", name: "invite" },
] as const;

for (const screen of screens) {
  test(`${screen.name} 首屏、品牌、触控尺寸与截图`, async ({ page }, info) => {
    await installFixture(page);
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.title, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "伙记首页" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("HuddleTab");
    const brandContrast = await page.locator(".account-brand strong").evaluate((element) => {
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map((value) => {
          const channel = Number(value) / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      const card = element.closest(".account-card")!;
      const background = getComputedStyle(card).backgroundColor;
      const foregroundLuminance = luminance(getComputedStyle(element).color);
      const backgroundLuminance = luminance(background === "rgba(0, 0, 0, 0)" ? getComputedStyle(document.querySelector("main")!).backgroundColor : background);
      return (Math.max(foregroundLuminance, backgroundLuminance) + .05) / (Math.min(foregroundLuminance, backgroundLuminance) + .05);
    });
    expect(brandContrast).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("main img")).toHaveCount(1);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("INPUT");
    await assertNoOverflow(page);
    const primary = page.getByRole(screen.role, { name: screen.action, exact: true });
    await assertPrimary(page, primary, screen.name !== "register" || page.viewportSize()!.width > 320);
    for (const input of await page.locator("input").all()) {
      expect(await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBe(16);
      expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    for (const toggle of await page.getByRole("button", { name: "显示密码" }).all()) {
      const box = (await toggle.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const card = await page.locator(".account-card").evaluate((element) => ({ width: element.getBoundingClientRect().width, border: getComputedStyle(element).borderTopWidth, shadow: getComputedStyle(element).boxShadow }));
    expect(card.width).toBeLessThanOrEqual(440);
    if (page.viewportSize()!.width < 640) {
      expect(card.border).toBe("0px");
      expect(card.shadow).toBe("none");
    }
    const bounds = (await page.locator(".account-card").boundingBox())!;
    const padding = await page.locator("main").evaluate((element) => ({ top: parseFloat(getComputedStyle(element).paddingTop), bottom: parseFloat(getComputedStyle(element).paddingBottom) }));
    const viewportHeight = page.viewportSize()!.height;
    if (bounds.height + padding.top + padding.bottom <= viewportHeight) {
      expect(Math.abs((bounds.y - padding.top) - (viewportHeight - bounds.y - bounds.height - padding.bottom))).toBeLessThanOrEqual(1);
    } else {
      expect(bounds.y).toBeGreaterThanOrEqual(padding.top);
    }
    await page.screenshot({ path: info.outputPath(`${screen.name}.png`), fullPage: true });
    // 可用高度缩短时顶部仍可达，表单及主按钮通过原生滚动完整访问。
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 260 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect((await page.locator(".account-card").boundingBox())!.y).toBeGreaterThanOrEqual(padding.top);
    const lastInput = page.locator("input").last();
    if (await lastInput.count()) {
      await lastInput.focus();
      await expect(lastInput).toBeInViewport();
    }
    await primary.scrollIntoViewIfNeeded();
    await assertPrimary(page, primary);
    await assertNoOverflow(page);
  });
}

test("邀请登录保留上下文，密码显隐与提交中状态可操作", async ({ page }) => {
  const state = await installFixture(page);
  await page.goto("/join/mobile-invite");
  await page.getByRole("link", { name: "登录", exact: true }).click();
  const username = page.getByRole("textbox", { name: "用户名" });
  await expect(username).toHaveAttribute("autocomplete", "username");
  await expect(username).toHaveAttribute("autocapitalize", "none");
  await expect(username).toHaveAttribute("spellcheck", "false");
  await expect(page.getByRole("link", { name: "注册新账号" })).toHaveAttribute("href", "/register?invite=mobile-invite");
  await username.fill("traveler");
  const password = page.getByLabel("密码", { exact: true });
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await password.fill("password123");
  await page.getByRole("button", { name: "显示密码" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("password123");
  await page.getByRole("button", { name: "隐藏密码" }).click();
  await expect(password).toHaveAttribute("type", "password");
  let finish!: () => void;
  state.authWait = new Promise<void>((resolve) => { finish = resolve; });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeDisabled();
  finish();
  await expect(page).toHaveURL(/\/join\/mobile-invite$/);
  await expect(page.getByRole("button", { name: "加入活动" })).toBeVisible();
  expect(state.authCalls).toBe(1);
});

test("注册校验、错误重试和邀请审批在紧凑布局中完成", async ({ page }) => {
  const state = await installFixture(page);
  await page.goto("/register?invite=mobile-invite");
  await page.getByRole("textbox", { name: "昵称" }).fill("小林");
  await page.getByRole("textbox", { name: "用户名" }).fill("traveler");
  await page.getByLabel("密码", { exact: true }).fill("password123");
  await page.getByLabel("确认密码").fill("password456");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("两次输入的密码不一致。");
  expect(state.authCalls).toBe(0);
  state.authError = true;
  await page.getByLabel("确认密码").fill("password123");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("这个用户名已被使用");
  await assertNoOverflow(page);
  state.authError = false;
  let finish!: () => void;
  state.authWait = new Promise<void>((resolve) => { finish = resolve; });
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("button", { name: "注册", exact: true })).toBeDisabled();
  finish();
  await expect(page).toHaveURL(/\/join\/mobile-invite\?request=request-1$/);
  await expect(page.getByText("等待活动所有者审批", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "伙记首页" })).toBeVisible();
  expect(state.joinCalls).toBe(1);
});

test("加载、失效邀请和注册策略错误沿用页面外壳", async ({ page }) => {
  const state = await installFixture(page);
  let finish!: () => void;
  state.invitationWait = new Promise<void>((resolve) => { finish = resolve; });
  await page.goto("/join/mobile-invite");
  await expect(page.getByRole("status")).toContainText("正在读取邀请");
  await expect(page.getByRole("link", { name: "伙记首页" })).toBeVisible();
  state.invitationError = true;
  finish();
  await expect(page.getByRole("alert")).toContainText("邀请已过期");
  await expect(page.getByRole("link", { name: "返回活动列表" })).toBeVisible();
  await assertNoOverflow(page);
  await page.goto("/register?invite=mobile-invite");
  await expect(page.getByRole("alert")).toContainText("邀请已过期");
  await expect(page.getByRole("link", { name: "伙记首页" })).toBeVisible();
  state.policyError = true;
  await page.goto("/register");
  await expect(page.getByRole("alert")).toContainText("暂时无法读取注册策略");
  await expect(page.getByRole("link", { name: "伙记首页" })).toBeVisible();
  state.policyError = false;
  state.policy = "INVITE_ONLY";
  await page.getByRole("button", { name: "重试" }).click();
  const invitation = page.getByRole("textbox", { name: "邀请口令" });
  await expect(invitation).toHaveAttribute("autocapitalize", "none");
  await expect(invitation).toHaveAttribute("spellcheck", "false");
  await expect(invitation).not.toBeFocused();
  await invitation.fill("mobile-invite");
  await page.getByRole("button", { name: "查看邀请" }).click();
  await expect(page).toHaveURL(/\/join\/mobile-invite$/);
});

test("绑定、审批结果和长名称在放大文字及短屏中仍可访问", async ({ page }, info) => {
  const state = await installFixture(page);
  state.signedIn = true;
  state.preview.purpose = "GUEST_BINDING";
  state.preview.guestDisplayName = "需要绑定的临时成员";
  state.preview.guestMemberId = "guest-1";
  state.preview.activityName = "与朋友一起出发的长途旅行".repeat(6);
  await page.goto("/join/mobile-invite");
  await expect(page.getByRole("button", { name: "确认绑定" })).toBeVisible();
  // 放大实际文本，并缩短视口模拟可用高度变化；真实软键盘与 Safari 自动缩放仍需实机验证。
  await page.addStyleTag({ content: ".account-card, .account-card p, .account-card strong, .account-card a, .account-card button { font-size: 24px; } .account-card h1 { font-size: 36px; }" });
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 360 });
  await assertNoOverflow(page);
  await page.getByRole("button", { name: "确认绑定" }).click();
  await expect(page.getByText("等待活动所有者审批", { exact: true })).toBeVisible();
  await assertNoOverflow(page);
  await page.screenshot({ path: info.outputPath("invite-large-text.png"), fullPage: true });
  for (const [status, message] of [["APPROVED", "申请已批准"], ["REJECTED", "申请未通过"], ["INVALIDATED", "邀请已作废"]]) {
    state.requestStatus = status;
    await page.reload();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "伙记首页" })).toBeVisible();
    await assertNoOverflow(page);
    if (status === "APPROVED") await expect(page.getByRole("link", { name: "打开活动" })).toHaveAttribute("href", "/activities/activity-1");
  }
});
