import { expect, test, type Page } from "@playwright/test";

/** 接口夹具只用于验收本轮页面交互，不会写入真实密钥或账号。 */
async function fixture(page: Page) {
  await page.addInitScript(() => {
    // 此套件禁止安装 Service Worker，提供“设备无订阅”结果以覆盖退出清理流程。
    if ("serviceWorker" in navigator) Object.defineProperty(navigator.serviceWorker, "ready", { value: Promise.resolve({ pushManager: { getSubscription: async () => null } }) });
  });
  const state = {
    ai: { enabled: true, baseUrl: "https://api.example.com/v1", apiKeyStatus: "CONFIGURED", models: [{ name: "gpt-4.1-mini", supportsImage: true }, { name: "deepseek-chat", supportsImage: false }], defaultModel: "gpt-4.1-mini", imageEnabled: true, maxImageBytes: 10485760, timeoutSeconds: 30, jsonMode: true, version: 1 },
    policy: { policy: "INVITE_ONLY", version: 1 },
    session: { userId: "preview-admin", username: "preview_admin", displayName: "管理员", avatarPreset: 4, isSystemAdmin: true },
    writes: [] as Record<string, unknown>[], fail: 0, loggedOut: false,
  };
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    const writing = route.request().method() !== "GET";
    let data: unknown = [];
    if (path === "/api/auth/session") {
      if (state.loggedOut) return route.fulfill({ status: 401, json: { error: { code: "AUTH_REQUIRED", message: "请登录" } } });
      data = state.session;
    } else if (path.endsWith("/csrf")) data = { token: "fixture" };
    else if (path === "/api/admin/ai-expense-draft-settings") {
      if (writing) {
        const body = route.request().postDataJSON(); state.writes.push(body);
        if (state.fail) return route.fulfill({ status: state.fail, json: { error: { code: state.fail === 409 ? "VERSION_CONFLICT" : "INTERNAL_ERROR", message: state.fail === 409 ? "设置版本已变化" : "保存失败，请重试" } } });
        const { apiKey, clearApiKey, ...fields } = body;
        state.ai = { ...state.ai, ...fields, apiKeyStatus: clearApiKey ? "NOT_SET" : apiKey ? "CONFIGURED" : state.ai.apiKeyStatus, version: state.ai.version + 1 };
      }
      data = state.ai;
    } else if (path === "/api/admin/registration-policy") {
      if (writing) state.policy = { ...route.request().postDataJSON(), version: state.policy.version + 1 };
      data = state.policy;
    } else if (path === "/api/admin/users") data = [{ id: "preview-admin", ...state.session, disabled: false }];
    else if (path === "/api/admin/system-information") data = { appVersion: "v0.0.28", pwaVersion: "v0.0.28", databaseVersion: "PostgreSQL 18.6", dataDirectory: "/data/huddletab/persistent-storage/volumes/production/attachments/long-directory-name" };
    else if (path === "/api/admin/storage") data = { databaseBytes: "33554432", uploadsBytes: "100663296", totalBytes: "134217728" };
    else if (path === "/api/me/push-settings") data = { available: false, preferences: { membership: true, expense: true, settlement: true, activity: true } };
    else if (path === "/api/me/profile") { state.session.displayName = route.request().postDataJSON().displayName; data = { displayName: state.session.displayName }; }
    else if (path === "/api/me/avatar") { state.session.avatarPreset = route.request().postDataJSON().avatarPreset; data = { avatarPreset: state.session.avatarPreset }; }
    else if (path === "/api/auth/logout") { state.loggedOut = true; data = {}; }
    else if (path === "/api/auth/registration-policy") data = { policy: state.policy.policy };
    return route.fulfill({ json: { data } });
  });
  return state;
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  const frame = await page.locator("main.app-frame").boundingBox();
  expect(frame!.width).toBeLessThanOrEqual(800);
  const padding = await page.locator("main.app-frame").evaluate(element => getComputedStyle(element).paddingLeft);
  expect(padding).toBe("16px");
}

// 等待浏览器实际绘制，避免手机截图在字体重排或面板淡入的前一帧截断内容。
async function painted(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("三卡片布局、明暗主题、长文本与放大字体", async ({ page }, info) => {
  await fixture(page); await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/admin/ai");
  await expect(page.getByRole("button", { name: "编辑模型 gpt-4.1-mini" })).toBeVisible();
  await expect(page.locator(".ai-settings-card")).toHaveCount(3);
  await fits(page);
  await page.screenshot({ scale: "css", path: info.outputPath("ai-light.png"), fullPage: true });
  await page.getByRole("button", { name: "编辑模型 gpt-4.1-mini" }).click();
  const model = page.getByRole("textbox", { name: "模型 ID", exact: true });
  await expect(model).toBeFocused();
  await painted(page);
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  await painted(page);
  await page.screenshot({ scale: "css", path: info.outputPath("model-editor.png") });
  await page.getByRole("button", { name: "删除模型", exact: true }).click();
  await expect(page.getByRole("button", { name: "删除并替换默认模型" })).toBeDisabled();
  await page.screenshot({ scale: "css", path: info.outputPath("delete-default.png") });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await model.fill("provider/" + "long-model-".repeat(10));
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.evaluate(() => { document.documentElement.classList.remove("light"); document.documentElement.classList.add("dark"); });
  await painted(page);
  await fits(page);
  await page.screenshot({ scale: "css", path: info.outputPath("ai-dark-long-model.png"), fullPage: true });
  // 模拟所有可见文本放大，检查固定宽度控件和长模型不会撑破页面。
  await page.locator("main").evaluate(main => {
    const elements = [...main.querySelectorAll<HTMLElement>("*")];
    const sizes = elements.map(element => parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => { element.style.fontSize = `${sizes[index] * 1.5}px`; });
  });
  await painted(page);
  await fits(page);
  await page.screenshot({ scale: "css", path: info.outputPath("ai-large-text.png"), fullPage: true });
});

test("模型局部草稿、默认删除与密钥统一保存", async ({ page }) => {
  const state = await fixture(page); await page.goto("/admin/ai");
  const save = page.getByRole("button", { name: "保存设置", exact: true }); await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("textbox", { name: "模型 ID", exact: true }).fill("discarded");
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "添加", exact: true })).toBeFocused();
  await expect(page.locator(".ai-model-list__row")).toHaveCount(2);
  await page.getByRole("button", { name: "编辑模型 gpt-4.1-mini" }).click();
  await page.getByRole("textbox", { name: "模型 ID", exact: true }).fill("  renamed-model  ");
  await page.getByRole("button", { name: "完成", exact: true }).click(); await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("radio", { name: "使用 renamed-model 作为默认模型" })).toBeChecked();
  await page.getByRole("button", { name: "更换", exact: true }).click();
  await page.getByLabel("新的 API 密钥", { exact: true }).fill("fixture-secret");
  expect(state.writes).toHaveLength(0);
  await save.click(); await expect(page.getByText("设置已保存", { exact: true })).toBeVisible();
  expect(state.writes[0]).toMatchObject({ apiKey: "fixture-secret", clearApiKey: false, defaultModel: "renamed-model", version: 1 });
  await expect(page.getByLabel("新的 API 密钥", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "编辑模型 renamed-model" }).click();
  await page.getByRole("button", { name: "删除模型", exact: true }).click();
  await page.getByLabel("新的默认模型", { exact: true }).selectOption({ label: "deepseek-chat" });
  await page.getByRole("button", { name: "删除并替换默认模型" }).click(); await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("switch", { name: "启用图片识别" })).not.toBeChecked();
  await page.getByRole("button", { name: "编辑模型 deepseek-chat" }).click();
  await page.getByRole("button", { name: "删除模型", exact: true }).click();
  await page.getByRole("button", { name: "删除并关闭 AI" }).click(); await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("switch", { name: "启用 AI 智能录入" })).not.toBeChecked();
  await save.click(); await expect(page.getByText("设置已保存", { exact: true })).toBeVisible();
  expect(state.writes[1]).toMatchObject({ enabled: false, imageEnabled: false, models: [], defaultModel: null, version: 2 });
});

test("离线、保存失败和版本冲突保留输入", async ({ page, context }) => {
  const state = await fixture(page); await page.goto("/admin/ai");
  const timeout = page.getByLabel("请求超时", { exact: true }); const save = page.getByRole("button", { name: "保存设置", exact: true });
  await timeout.fill("60");
  await context.setOffline(true); await expect(save).toBeDisabled(); await expect(timeout).toHaveValue("60");
  state.ai = { ...state.ai, timeoutSeconds: 90, version: 2 };
  await context.setOffline(false); await expect(save).toBeEnabled(); await expect(timeout).toHaveValue("60");
  state.fail = 500; await save.click(); await expect(page.getByRole("alert")).toContainText("保存失败"); await expect(timeout).toHaveValue("60");
  state.fail = 409; await save.click(); await expect(page.getByRole("alert")).toContainText("其他管理员修改"); await expect(timeout).toHaveValue("60");
  await expect(page.getByText("重新加载将放弃当前未保存的修改。")).toBeVisible();
  state.fail = 0; await page.getByRole("button", { name: "放弃修改并重新加载" }).click(); await expect(timeout).toHaveValue("90");
  await expect(save).toBeDisabled(); await timeout.fill("100"); await save.click(); await expect(page.getByText("设置已保存", { exact: true })).toBeVisible();
  expect(state.writes.at(-1)).toMatchObject({ timeoutSeconds: 100, version: 2 });
});

test("个人资料与管理入口、注册策略和系统信息", async ({ page }, info) => {
  const state = await fixture(page); await page.goto("/me");
  await expect(page.getByRole("button", { name: "修改昵称" })).toBeVisible();
  await expect(page.locator(".profile-panel, .me-page .settings-list")).toHaveCount(4);
  await expect(page.locator("main h2")).toHaveCount(0); await fits(page);
  await page.screenshot({ scale: "css", path: info.outputPath("me-light.png"), fullPage: true });
  await page.getByRole("button", { name: "修改昵称" }).click(); await page.getByRole("textbox", { name: "昵称" }).fill("新的昵称");
  await page.getByRole("button", { name: "保存昵称" }).click(); await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".profile-identity-button strong")).toHaveText("新的昵称");
  await page.getByRole("button", { name: "选择头像" }).click(); await page.getByRole("button", { name: "人物 6", exact: true }).click();
  await page.getByRole("button", { name: "保存头像" }).click(); await expect(page.getByRole("dialog")).toBeHidden(); expect(state.session.avatarPreset).toBe(6);
  await page.getByRole("button", { name: /系统推送：/ }).click(); await expect(page.getByText("服务器尚未配置推送服务，请联系管理员。")).toBeVisible();
  await page.getByRole("button", { name: "关闭系统推送" }).click(); await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: /主题：/ }).click(); await page.getByRole("radio", { name: "暗色", exact: true }).click();
  await page.getByRole("button", { name: "关闭主题" }).click(); await expect(page.getByRole("dialog")).toBeHidden();
  await page.screenshot({ scale: "css", path: info.outputPath("me-dark.png"), fullPage: true });
  await page.getByRole("link", { name: "系统管理", exact: true }).click();
  await expect(page.locator(".admin-entry-list a")).toHaveText(["用户管理", "AI 智能录入", "系统信息"]);
  await page.screenshot({ scale: "css", path: info.outputPath("admin-home.png"), fullPage: true });
  await page.getByRole("link", { name: "用户管理", exact: true }).click(); await page.getByRole("link", { name: "注册策略", exact: true }).click();
  await page.getByRole("radio", { name: "开放注册", exact: true }).click(); await expect(page.getByRole("radio", { name: "开放注册", exact: true })).toBeChecked();
  await expect(page.getByText("注册策略已保存")).toBeVisible(); await fits(page);
  await page.screenshot({ scale: "css", path: info.outputPath("registration-policy.png"), fullPage: true });
  await page.getByRole("link", { name: "返回用户管理" }).click(); await expect(page).toHaveURL(/\/admin\/users$/);
  await page.getByRole("link", { name: "返回系统管理" }).click(); await page.getByRole("link", { name: "系统信息", exact: true }).click();
  await expect(page.locator("main section").first()).toHaveAttribute("aria-label", "运行信息");
  await expect(page.getByText("128 MB", { exact: true })).toBeVisible(); await fits(page);
  await page.screenshot({ scale: "css", path: info.outputPath("system-info.png"), fullPage: true });
  await page.goto("/me"); await page.getByRole("button", { name: "退出登录", exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
});
