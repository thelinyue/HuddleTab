import { expect, test } from "@playwright/test";
import { assertNoHorizontalOverflow, createActivity, login } from "./support/product";

test("WebKit 可登录、创建活动并打开流水与结算", async ({ page }) => {
  const activityName = `WebKit Smoke ${Date.now()}`;
  await login(page);
  await createActivity(page, activityName);
  const navigation = page.getByRole("navigation", { name: "活动导航" });
  await navigation.getByRole("link", { name: "流水" }).click();
  await expect(page.getByRole("heading", { name: "全部流水" })).toBeVisible();
  await navigation.getByRole("link", { name: "结算" }).click();
  await expect(page.getByRole("heading", { name: "推荐转账" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});
