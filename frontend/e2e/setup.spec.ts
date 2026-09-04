import { expect, test } from "@playwright/test";

const username = process.env.HUDDLETAB_E2E_USERNAME;
const password = process.env.HUDDLETAB_E2E_PASSWORD;

test("空数据库显示网页初始化表单并完成首位管理员初始化", async ({ page }, testInfo) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "初始化管理员" })).toBeVisible();
  const fields = page.locator(".setup-form input");
  await expect(fields).toHaveCount(4);
  await expect(fields.nth(0)).toHaveAttribute("name", "displayName");
  await expect(fields.nth(1)).toHaveAttribute("name", "username");
  await expect(fields.nth(2)).toHaveAttribute("name", "password");
  await expect(fields.nth(3)).toHaveAttribute("name", "confirmPassword");

  if (testInfo.project.name === "chromium-setup-desktop") return;
  if (!username || !password) throw new Error("缺少网页初始化测试凭据环境变量。");
  await page.locator('input[name="displayName"]').fill("Phase 1E 管理员");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.getByRole("button", { name: "完成初始化" }).click();
  await expect(page).toHaveURL(/\/activities$/);

  await page.goto("/activities/not-created-yet");
  await expect(page).toHaveURL(/\/activities\/not-created-yet$/);
});
