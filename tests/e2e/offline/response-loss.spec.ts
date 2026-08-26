import { expect, test } from "@playwright/test";

import {
  countExpenses,
  prepareOfflineUser,
  readLocalMutation,
} from "./support";

test("服务端提交后响应丢失，重试沿用 mutation ID 且仅创建一笔消费", async ({
  page,
}) => {
  const { activityId } = await prepareOfflineUser(page);
  await page.goto(`/activities/${activityId}`);
  await expect(page.getByRole("button", { name: "记一笔" })).toBeVisible();

  const mutationIds: string[] = [];
  let responseDropped = false;
  await page.route(
    `**/api/activities/${activityId}/expenses`,
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const payload = route.request().postDataJSON() as {
        clientMutationId: string;
      };
      mutationIds.push(payload.clientMutationId);
      if (!responseDropped) {
        // 真实请求已由 route.fetch() 送达服务端；随后仅切断浏览器收到的响应。
        await route.fetch();
        responseDropped = true;
        await route.abort("connectionfailed");
        return;
      }
      await route.continue();
    },
  );

  await page.getByRole("button", { name: "记一笔" }).click();
  await page.getByLabel("金额").fill("88");
  await page.getByLabel("用途").fill("响应丢失午餐");
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect(page.getByText("待同步", { exact: true })).toBeVisible();
  await expect.poll(() => responseDropped).toBe(true);
  const queued = await readLocalMutation(page, activityId);
  expect(queued?.payload?.clientMutationId).toHaveLength(36);

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("待同步", { exact: true })).toBeHidden();
  await expect
    .poll(() => readLocalMutation(page, activityId))
    .toMatchObject({
      status: "SYNCED",
    });
  expect(mutationIds).toEqual([
    queued?.payload?.clientMutationId,
    queued?.payload?.clientMutationId,
  ]);
  await expect.poll(() => countExpenses(page, activityId)).toBe(1);
});
