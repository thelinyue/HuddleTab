import { expect, test } from "@playwright/test";

import { countExpenses, prepareOfflineUser } from "./support";

test("断网新增、刷新保留、联网后服务器仅一笔", async ({ page, context }) => {
  const { activityId } = await prepareOfflineUser(page);
  await page.goto(`/activities/${activityId}`);
  await expect(page.getByRole("button", { name: "记一笔" })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(async () =>
          Boolean(
            navigator.serviceWorker.controller &&
            (await caches.match(window.location.href)) &&
            (
              await Promise.all(
                [...document.scripts]
                  .map((script) => script.src)
                  .filter(Boolean)
                  .map((url) => caches.match(url)),
              )
            ).every(Boolean),
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  await context.setOffline(true);
  await page.getByRole("button", { name: "记一笔" }).click();
  await page.getByLabel("金额").fill("88");
  await page.getByLabel("用途").fill("离线午餐");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("待同步", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          await new Promise<boolean>((resolve) => {
            const userId = sessionStorage.getItem(
              `huddletab:expense-feed-user:${id}`,
            );
            if (!userId) return resolve(false);
            const request = indexedDB.open(`huddletab:${userId}`);
            request.onerror = () => resolve(false);
            request.onsuccess = () => {
              const database = request.result;
              const lookup = database
                .transaction("activity_snapshots")
                .objectStore("activity_snapshots")
                .get(id);
              lookup.onsuccess = () => resolve(Boolean(lookup.result));
              lookup.onerror = () => resolve(false);
            };
          }),
        activityId,
      ),
    )
    .toBe(true);

  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("huddletab:offline")),
    )
    .toBe("true");
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await page.reload();
  await expect(page.getByText("离线午餐", { exact: true })).toBeVisible();
  await page.unroute("**/api/**");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("待同步", { exact: true })).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          await new Promise<string | undefined>((resolve) => {
            const userId = sessionStorage.getItem(
              `huddletab:expense-feed-user:${id}`,
            );
            if (!userId) return resolve(undefined);
            const request = indexedDB.open(`huddletab:${userId}`);
            request.onerror = () => resolve(undefined);
            request.onsuccess = () => {
              const records = request.result
                .transaction("pending_mutations")
                .objectStore("pending_mutations")
                .getAll();
              records.onsuccess = () => {
                const mutation = records.result[0] as
                  | {
                      status?: string;
                      lastError?: { code?: string; message?: string };
                    }
                  | undefined;
                resolve(
                  JSON.stringify({
                    status: mutation?.status,
                    lastError: mutation?.lastError,
                  }),
                );
              };
              records.onerror = () => resolve(undefined);
            };
          }),
        activityId,
      ),
    )
    .toBe(JSON.stringify({ status: "SYNCED" }));
  await expect.poll(() => countExpenses(page, activityId)).toBe(1);
});
