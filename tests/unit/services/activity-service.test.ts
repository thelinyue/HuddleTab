import { expect, it, vi } from "vitest";

import { ActivityService } from "@/server/services/activity-service";

it("创建活动在开启事务前拒绝固定目录外的币种", async () => {
  const begin = vi.fn();
  const service = new ActivityService({ begin } as never);

  await expect(
    service.create({
      session: { user: { id: "user-1" } },
      name: "测试活动",
      baseCurrency: "BTC",
      startDate: "2026-08-31",
      ownerDisplayName: "Owner",
    }),
  ).rejects.toThrow("不支持的币种");
  expect(begin).not.toHaveBeenCalled();
});
