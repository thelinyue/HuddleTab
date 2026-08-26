import { expect, test, vi } from "vitest";
import { refreshSnapshotIfChanged } from "@/pwa/sync-queue/refresh-snapshot";
import { SyncCoordinator } from "@/pwa/sync-queue/sync-coordinator";

test("Revision 不同则完整替换，相同则不重复拉取", async () => {
  const repository = {
    get: vi.fn().mockResolvedValue({ revision: "8" }),
    replace: vi.fn(),
  };
  const api = {
    getRevision: vi.fn().mockResolvedValue({ revision: "9" }),
    fetchSnapshot: vi.fn().mockResolvedValue({
      userId: "u1",
      revision: "9",
      snapshot: { totalExpenseMinor: "8800" },
    }),
  };

  await refreshSnapshotIfChanged("a1", api, repository, () => 100);
  await refreshSnapshotIfChanged(
    "a1",
    api,
    {
      get: vi.fn().mockResolvedValue({ revision: "9" }),
      replace: vi.fn(),
    },
    () => 100,
  );

  expect(api.fetchSnapshot).toHaveBeenCalledOnce();
  expect(repository.replace).toHaveBeenCalledWith({
    activityId: "a1",
    userId: "u1",
    revision: "9",
    fetchedAt: 100,
    snapshot: { totalExpenseMinor: "8800" },
  });
});

test("活动结束导致同步拒绝时保留原始离线消费输入", async () => {
  const item = {
    id: "m1",
    activityId: "a1",
    payload: { title: "晚餐", originalAmountMinor: "8800" },
  };
  const queue = {
    nextReady: vi.fn().mockResolvedValueOnce(item).mockResolvedValue(null),
    markSyncing: vi.fn(),
    markRetryable: vi.fn(),
    markRejected: vi.fn(),
    markSynced: vi.fn(),
  };
  const api = {
    createExpense: vi.fn().mockRejectedValue({
      status: 409,
      code: "ACTIVITY_ENDED",
      message: "活动已经结束，这笔离线消费未同步。",
    }),
  };

  await new SyncCoordinator(queue, api).run();

  expect(queue.markRejected).toHaveBeenCalledWith("m1", {
    code: "ACTIVITY_ENDED",
    message: "活动已经结束，这笔离线消费未同步。",
  });
  expect(item.payload).toEqual({ title: "晚餐", originalAmountMinor: "8800" });
});

test("消费同步成功后刷新完整快照，快照失败不重新提交账单", async () => {
  const item = { id: "m1", activityId: "a1", payload: {} };
  const queue = {
    nextReady: vi.fn().mockResolvedValueOnce(item).mockResolvedValue(null),
    markSyncing: vi.fn(),
    markRetryable: vi.fn(),
    markRejected: vi.fn(),
    markSynced: vi.fn(),
    setInfo: vi.fn(),
  };
  const api = {
    createExpense: vi.fn().mockResolvedValue({ expense: { id: "expense-1" } }),
  };
  const snapshots = { refresh: vi.fn().mockRejectedValue(new Error("断网")) };

  await new SyncCoordinator(queue, api, () => 0, undefined, snapshots).run();

  expect(queue.markSynced).toHaveBeenCalledWith("m1", "expense-1");
  expect(snapshots.refresh).toHaveBeenCalledWith("a1");
  expect(queue.markRetryable).not.toHaveBeenCalled();
  expect(queue.setInfo).toHaveBeenCalledWith("m1", {
    code: "SNAPSHOT_REFRESH_PENDING",
    message: "账单已同步，活动数据待刷新。",
  });
});
