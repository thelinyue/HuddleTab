import { expect, test, type Page } from "@playwright/test";

/** 只拦截浏览器中的管理接口；长昵称、交叉角色与长列表共同覆盖窄屏和返回定位。 */
async function installFixture(page: Page) {
  const users = [
    { id: "me", username: "admin", displayName: "张三这是一个很长很长的当前管理员昵称", avatarPreset: 1, disabled: false, isSystemAdmin: true },
    { id: "alice", username: "alice", displayName: "李四", avatarPreset: 2, disabled: false, isSystemAdmin: false },
    { id: "disabled", username: "alice-admin", displayName: "王五这是一个很长很长的已禁用管理员昵称", avatarPreset: 3, disabled: true, isSystemAdmin: true },
    ...Array.from({ length: 21 }, (_, i) => ({ id: `user-${i}`, username: `user${i}`, displayName: `同行用户${i + 1}`, avatarPreset: i % 8, disabled: i === 0, isSystemAdmin: i === 1 })),
  ];
  const controls = { users, writes: 0, fail: false };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      controls.writes++;
      if (controls.fail) return route.fulfill({ status: 409, json: { error: route.request().method() === "DELETE" ? { code: "USER_HAS_BUSINESS_RECORDS", message: "该账号存在业务或历史记录，无法删除，请使用禁用账号。" } : { code: "LAST_ACTIVE_ADMIN", message: "至少保留一位可登录的系统管理员。" } } });
      if (route.request().method() === "DELETE") {
        const index = users.findIndex((user) => user.id === path.split("/").at(-1));
        const [target] = users.splice(index, 1);
        return route.fulfill({ json: { data: { userId: target.id, changed: true } } });
      }
      const target = users.find((user) => user.id === path.split("/").at(-2))!;
      const body = route.request().postDataJSON();
      if (path.endsWith("/status")) target.disabled = body.disabled;
      if (path.endsWith("/system-admin")) target.isSystemAdmin = body.granted;
      return route.fulfill({ json: { data: { userId: target.id, changed: true } } });
    }
    let data: unknown = [];
    if (path === "/api/auth/session") data = { userId: "me", username: "admin", displayName: users[0].displayName, isSystemAdmin: true };
    else if (path.endsWith("/csrf")) data = { token: "fixture" };
    else if (path === "/api/admin/users") data = users;
    return route.fulfill({ json: { data } });
  });
  return controls;
}

test("单行布局、筛选计数和面板完整身份", async ({ page }, info) => {
  await installFixture(page);
  await page.goto("/admin/users");
  await expect(page.getByRole("button", { name: "全部 24" })).toBeVisible();
  await expect(page.getByRole("button", { name: "管理员 3" })).toBeVisible();
  const geometry = await page.locator(".admin-user-row").evaluateAll((rows) => rows.map((row) => {
    const rect = row.getBoundingClientRect();
    const children = [...row.children].map((child) => child.getBoundingClientRect());
    return { height: rect.height, fits: children.every((child) => child.left >= rect.left && child.right <= rect.right + 1 && child.top >= rect.top && child.bottom <= rect.bottom) };
  }));
  expect(geometry.every((row) => row.height === 56 && row.fits)).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath("users-list.png") });
  await page.getByRole("searchbox").fill("  ALICE  ");
  await expect(page.getByRole("button", { name: "全部 2" })).toBeVisible();
  await page.getByRole("button", { name: "管理员 1" }).click();
  await expect(page.locator(".admin-user-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "正常 1" })).toBeVisible();
  await page.locator(".admin-user-row").click();
  const panel = page.getByRole("dialog", { name: "管理用户" });
  await expect(panel.getByText("@alice-admin")).toBeVisible();
  await expect(panel.getByText("王五这是一个很长很长的已禁用管理员昵称")).toBeVisible();
  await panel.getByRole("button", { name: "启用账号" }).click();
  await expect(page.getByRole("button", { name: "已禁用 0" })).toBeVisible();
  await expect(panel.getByText("账号已启用。")).toBeVisible();
  await page.screenshot({ path: info.outputPath("user-panel.png") });
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveValue("  ALICE  ");
  await expect(page.locator(".admin-user-row")).toBeFocused();
});

test("确认弹层键盘操作、错误重试、密码关闭清空", async ({ page }) => {
  const controls = await installFixture(page);
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "管理用户 李四 @alice" }).click();
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: "禁用账号" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "确认禁用账号" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirm).not.toBeVisible();
  await expect(panel).toBeVisible();
  expect(controls.writes).toBe(0);
  controls.fail = true;
  await panel.getByRole("button", { name: "禁用账号" }).click();
  await confirm.getByRole("button", { name: "确认禁用账号" }).click();
  await expect(confirm.getByRole("alert")).toContainText("至少保留一位");
  controls.fail = false;
  await confirm.getByRole("button", { name: "确认禁用账号" }).click();
  await expect(confirm).not.toBeVisible();
  await expect(page.getByRole("button", { name: "已禁用 3" })).toBeVisible();
  await panel.getByRole("button", { name: "重置密码" }).click();
  await panel.getByLabel("新密码", { exact: true }).fill("temporary-secret");
  await panel.getByRole("button", { name: "关闭重置密码" }).click();
  await expect(panel).not.toBeVisible();
  await page.getByRole("button", { name: /管理用户 李四/ }).click();
  await panel.getByRole("button", { name: "重置密码" }).click();
  await expect(panel.getByLabel("新密码", { exact: true })).toHaveValue("");
  await panel.getByRole("button", { name: "关闭重置密码" }).click();
  await expect(panel).not.toBeVisible();
  await page.getByRole("button", { name: /管理用户 王五/ }).click();
  await panel.getByRole("button", { name: "重置密码" }).click();
  await expect(panel.getByLabel("新密码", { exact: true })).toHaveValue("");
});

test("删除空账号的确认、错误重试、列表计数和焦点恢复", async ({ page }, info) => {
  const controls = await installFixture(page);
  await page.goto("/admin/users");
  await page.getByRole("searchbox").fill("alice");
  await page.getByRole("button", { name: "管理用户 李四 @alice" }).click();
  const panel = page.getByRole("dialog", { name: "管理用户" });
  await panel.getByRole("button", { name: "删除账号", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("李四（@alice）");
  await expect(confirm.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath("delete-user-confirm.png") });
  expect(await confirm.evaluate((element) => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(confirm).not.toBeVisible();
  expect(controls.writes).toBe(0);
  await panel.getByRole("button", { name: "删除账号", exact: true }).click();
  controls.fail = true;
  await confirm.getByRole("button", { name: "确认删除账号" }).click();
  await expect(confirm.getByRole("alert")).toContainText("请使用禁用账号");
  await expect(page.getByRole("button", { name: "全部 2" })).toBeVisible();
  controls.fail = false;
  await confirm.getByRole("button", { name: "确认删除账号" }).click();
  await expect(confirm).not.toBeVisible();
  await expect(panel).not.toBeVisible();
  await expect(page.getByText("账号已删除。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "全部 1" })).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveValue("alice");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(page.getByRole("button", { name: "管理用户 李四 @alice" })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("delete-user-complete.png") });
});

test("长列表返回保持位置，减少动态效果时焦点仍恢复", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installFixture(page);
  await page.goto("/admin/users");
  const row = page.getByRole("button", { name: "管理用户 同行用户21 @user20" });
  await row.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  await row.click();
  await page.getByRole("button", { name: "关闭管理用户" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(row).toBeFocused();
  expect(Math.abs(await page.evaluate(() => window.scrollY) - scroll)).toBeLessThanOrEqual(1);
});
