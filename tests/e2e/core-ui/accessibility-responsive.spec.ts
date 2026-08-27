import { expect, test } from "@playwright/test";

test("桌面和移动端保持居中单列且没有横向滚动", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "登录" })).toBeVisible();
  expect(
    await page
      .locator("body")
      .evaluate((body) => body.scrollWidth <= window.innerWidth),
  ).toBe(true);
  if (test.info().project.name === "desktop-chromium") {
    const width = await page
      .locator("main")
      .evaluate((element) => Math.round(element.getBoundingClientRect().width));
    expect(width).toBeLessThanOrEqual(768);
  }
});

test("系统暗色偏好应用语义主题，公开首屏保持可访问", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("heading", { name: "登录" })).toBeVisible();
});
