import { expect, test, vi } from "vitest";

import { syncForegroundQueue } from "@/pwa/sync-queue/sync-triggers";

test("同一用户的重叠前台同步复用同一个执行任务", async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const create = vi.fn().mockImplementation(() => pending);

  const first = syncForegroundQueue("shared-user", create);
  const second = syncForegroundQueue("shared-user", create);

  expect(second).toBe(first);
  resolve();
  await first;
});
import "fake-indexeddb/auto";
