import { expect, test } from "@playwright/test";

test("有待同步数据时显示先同步再更新的提示", async ({ page }) => {
  await page.goto("/test/pwa-update?pending=1&waiting=1");

  await expect(page.getByText("有新版本可用，完成同步后更新")).toBeVisible();
  await expect(page.getByRole("button", { name: "立即更新" })).toBeDisabled();
});
