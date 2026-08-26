import { expect, it, vi } from "vitest";

import { startOrphanAttachmentCleanup } from "@/server/jobs/orphan-attachment-cleanup";

it("启动任务使用数据库维护状态决定是否运行，并注册 24 小时间隔", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const setInterval = vi.fn().mockReturnValue({ unref: vi.fn() });
  const sql = vi.fn().mockResolvedValue([{ maintenance_mode: true }]);
  let isMaintenanceActive: (() => Promise<boolean>) | undefined;

  const stop = startOrphanAttachmentCleanup(sql as never, {
    createCleanup: (nextIsMaintenanceActive) => {
      isMaintenanceActive = nextIsMaintenanceActive;
      return { run };
    },
    setInterval,
  });

  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 86_400_000);
  await expect(isMaintenanceActive?.()).resolves.toBe(true);
  expect(sql).toHaveBeenCalledOnce();
  expect(stop).toBeTypeOf("function");
});
