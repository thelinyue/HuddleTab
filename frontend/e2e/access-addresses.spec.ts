import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, origin: string) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) throw new Error("需要可丢弃实例的 ADMIN_USERNAME 和 ADMIN_PASSWORD。");
  await page.goto(`${origin}/login`);
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/activities$/);
  await page.goto(`${origin}/admin/access-addresses`);
  await expect(page.getByRole("heading", { name: "访问地址" })).toBeVisible();
}

test("首次配置、多入口登录、移动端布局与旧入口撤销", async ({ page, browser, baseURL }, info) => {
  const initial = new URL(baseURL!).origin;
  const alternate = new URL(initial);
  alternate.hostname = "localhost";
  const next = alternate.origin;
  await login(page, initial);
  await expect(page.getByText(/MCP 暂未开放/)).toBeVisible();
  await page.getByRole("button", { name: "添加当前地址" }).click();
  await page.getByLabel("添加地址", { exact: true }).fill(next);
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("立即生效");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`access-addresses-${width}.png`), fullPage: true });
  }
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const switched = await context.newPage();
    await login(switched, next);
    await switched.getByRole("button", { name: `移除 ${initial}`, exact: true }).click();
    await switched.getByRole("button", { name: "保存", exact: true }).click();
    await expect(switched.getByRole("status")).toContainText("立即生效");
    const oldResponse = await page.request.get(`${initial}/api/auth/session`);
    expect(oldResponse.status()).toBe(403);
    expect((await oldResponse.json()).error.code).toBe("ACCESS_ADDRESS_FORBIDDEN");
    await switched.reload();
    await expect(switched.getByText(next, { exact: true }).last()).toBeVisible();
    expect((await switched.request.get(`${next}/api/auth/session`)).status()).toBe(200);
  } finally { await context.close(); }
});
