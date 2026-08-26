import { expect, test } from "@playwright/test";

import {
  countAttachments,
  countExpenses,
  prepareOfflineUser,
} from "./offline/support";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+I3M9WQAAAABJRU5ErkJggg==",
  "base64",
);

test("附件失败不回滚账单，手动重试通过真实 API 补传", async ({
  page,
  context,
}) => {
  const { activityId } = await prepareOfflineUser(page);
  await page.goto(`/activities/${activityId}`);
  await expect(page.getByRole("button", { name: "记一笔" })).toBeVisible();

  let intercepted = 0;
  await context.route("**/attachments", async (route) => {
    intercepted += 1;
    await route.fulfill({ status: 503 });
  });
  await page.getByRole("button", { name: "记一笔" }).click();
  await page.getByLabel("金额").fill("88");
  await page.getByLabel("用途").fill("附件午餐");
  await page.getByRole("button", { name: "更多设置" }).click();
  await page.getByLabel("附件（最多三张）").setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect(
    page.getByText("账单已同步，附件待同步。", { exact: true }),
  ).toBeVisible();
  expect(intercepted).toBe(1);
  await expect.poll(() => countExpenses(page, activityId)).toBe(1);
  await expect.poll(() => countAttachments(activityId)).toBe(0);

  await context.unroute("**/attachments");
  await page.getByRole("button", { name: "重试同步" }).click();
  await expect(
    page.getByText("账单已同步，附件待同步。", { exact: true }),
  ).toBeHidden();
  await expect.poll(() => countExpenses(page, activityId)).toBe(1);
  await expect.poll(() => countAttachments(activityId)).toBe(1);
});
