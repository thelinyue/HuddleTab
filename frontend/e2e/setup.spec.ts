import { expect, test } from "@playwright/test";

test("空数据库的任意页面进入 CLI 初始化引导", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "初始化管理员" })).toBeVisible();
  await expect(page.getByText(/docker compose exec app huddletab bootstrap-user/)).toBeVisible();
  await expect(page.getByLabel("用户名")).toHaveCount(0);
  await expect(page.getByLabel("密码")).toHaveCount(0);

  await page.goto("/activities/not-created-yet");
  await expect(page).toHaveURL(/\/setup$/);
});
