import { expect, test } from "@playwright/test";

test("shows the HuddleTab product shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "伙记" })).toBeVisible();
  await expect(
    page.getByText("一起花，清楚分。", { exact: true }),
  ).toBeVisible();
});
