import { expect, test } from "@playwright/test";

import { prepareOfflineUser } from "./support";

test("离线时 Settlement 与活动生命周期命令没有可用的提交路径", async ({
  page,
  context,
}) => {
  const { activityId } = await prepareOfflineUser(page);

  await page.goto(`/activities/${activityId}/settlements`);
  const recordSettlement = page.getByRole("button", { name: "记录结算" });
  await expect(recordSettlement).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(recordSettlement).toBeDisabled();
  await expect(
    page.getByText("结算必须联网后记录。", { exact: true }),
  ).toBeVisible();

  await context.setOffline(false);
  await page.goto(`/activities/${activityId}/more`);
  const endActivity = page.getByRole("button", { name: "结束活动" });
  await expect(endActivity).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(endActivity).toBeDisabled();
  await expect(
    page.getByText("活动操作必须联网后执行。", { exact: true }),
  ).toBeVisible();
});
