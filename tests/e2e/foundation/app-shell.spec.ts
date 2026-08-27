import { expect, test } from "@playwright/test";

test("shows the HuddleTab product shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("伙记", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "登录" })).toBeVisible();
});
