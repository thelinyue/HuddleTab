import { expect, test } from "@playwright/test";

import {
  countExpenses,
  prepareOfflineUser,
  readLocalMutation,
  setActivityStatus,
} from "./support";

test("离线期间活动结束时，本地消费被最终拒绝并保留输入", async ({
  page,
  context,
}) => {
  const { activityId } = await prepareOfflineUser(page);
  await page.goto(`/activities/${activityId}`);
  await expect(page.getByRole("button", { name: "记一笔" })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("button", { name: "记一笔" }).click();
  await page.getByLabel("金额").fill("88");
  await page.getByLabel("用途").fill("已结束活动的离线晚餐");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("待同步", { exact: true })).toBeVisible();

  await setActivityStatus(activityId, "ENDED");
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(
    page.getByText("活动已结束，仅可继续处理实际结算。", { exact: true }),
  ).toBeVisible();
  const localExpense = page.getByRole("article", { name: "本地离线消费" });
  await expect(localExpense).toContainText("已结束活动的离线晚餐");
  await expect(localExpense).toContainText(/88(?:\.00)?/);
  await expect
    .poll(() => readLocalMutation(page, activityId))
    .toMatchObject({
      status: "REJECTED",
      payload: {
        title: "已结束活动的离线晚餐",
        originalAmountMinor: "8800",
      },
      lastError: { message: "活动已结束，仅可继续处理实际结算。" },
    });
  await expect.poll(() => countExpenses(page, activityId)).toBe(0);
});
