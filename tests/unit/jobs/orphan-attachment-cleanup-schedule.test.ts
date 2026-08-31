import { expect, it, vi } from "vitest";

import { startOrphanAttachmentCleanup } from "@/server/jobs/orphan-attachment-cleanup";

it("启动任务直接运行并注册 24 小时间隔", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const setInterval = vi.fn().mockReturnValue({ unref: vi.fn() });
  const sql = vi.fn();

  const stop = startOrphanAttachmentCleanup(sql as never, {
    createCleanup: () => ({ run }),
    setInterval,
  });

  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 86_400_000);
  expect(sql).not.toHaveBeenCalled();
  expect(stop).toBeTypeOf("function");
});
