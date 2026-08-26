import { expect, test, vi } from "vitest";
import { SyncCoordinator } from "@/pwa/sync-queue/sync-coordinator";
const item = { id: "m1", activityId: "a1", payload: {} };
test("网络与 5xx 有限退避，422 进入 REJECTED", async () => {
  const queue = {
    nextReady: vi.fn().mockResolvedValueOnce(item).mockResolvedValue(null),
    markSyncing: vi.fn(),
    markRetryable: vi.fn(),
    markRejected: vi.fn(),
    markSynced: vi.fn(),
  };
  const api = { createExpense: vi.fn().mockRejectedValue({ kind: "network" }) };
  await new SyncCoordinator(queue, api, () => 0).run();
  expect(queue.markRetryable).toHaveBeenCalledWith(
    "m1",
    1000,
    expect.any(Object),
  );
});
test("同一协调器不并发处理队列", async () => {
  let resolve!: () => void;
  const gate = new Promise<void>((done) => {
    resolve = done;
  });
  const queue = {
    nextReady: vi.fn().mockResolvedValueOnce(item).mockResolvedValue(null),
    markSyncing: vi.fn(),
    markRetryable: vi.fn(),
    markRejected: vi.fn(),
    markSynced: vi.fn(),
  };
  const api = { createExpense: vi.fn().mockReturnValue(gate) };
  const sync = new SyncCoordinator(queue, api, () => 0);
  const first = sync.run();
  const second = sync.run();
  await vi.waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
  resolve();
  await Promise.all([first, second]);
});
