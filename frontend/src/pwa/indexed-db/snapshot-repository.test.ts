import "fake-indexeddb/auto";

import { deleteDB } from "idb";
import { afterEach, expect, it, vi } from "vitest";

const snapshotApi = vi.hoisted(() => ({ fetchActivitySnapshot: vi.fn() }));
vi.mock("../../features/activities/snapshot-api", () => snapshotApi);

import { databaseName } from "./database";
import { SnapshotRepository } from "./snapshot-repository";

const fetchActivitySnapshotMock = snapshotApi.fetchActivitySnapshot;
const snapshot = {
  activity: { activityId: "activity-1" },
  expenses: [],
  ledger: { balances: [], baseCurrency: "CNY", revision: "2" },
  members: [],
  recommendations: {
    baseCurrency: "CNY",
    recommendations: [],
    revision: "2",
  },
  revision: "2",
  settlements: [],
};

afterEach(async () => {
  vi.clearAllMocks();
  await deleteDB(databaseName("user-1"));
});

it("用新 ETag 和完整 Snapshot 原子替换同一活动旧记录", async () => {
  const repository = new SnapshotRepository("user-1", () => 200);
  await repository.replace("activity-1", {
    etag: 'W/"1"',
    snapshot: {
      ...snapshot,
      revision: "1",
      expenses: [{ expenseId: "old" }],
    },
  } as never);
  await repository.replace("activity-1", {
    etag: 'W/"2"',
    snapshot: { ...snapshot, revision: "2", expenses: [] },
  } as never);

  expect(await repository.get("activity-1")).toEqual({
    userId: "user-1",
    activityId: "activity-1",
    etag: 'W/"2"',
    snapshot: { ...snapshot, revision: "2", expenses: [] },
    fetchedAt: 200,
  });
});

it("200 refresh 持久化新的完整 Snapshot", async () => {
  const repository = new SnapshotRepository("user-1", () => 250);
  fetchActivitySnapshotMock.mockResolvedValue({
    status: "modified",
    value: { etag: 'W/"2"', snapshot },
  });

  const refreshed = await repository.refresh("activity-1");

  expect(refreshed).toEqual({
    userId: "user-1",
    activityId: "activity-1",
    etag: 'W/"2"',
    snapshot,
    fetchedAt: 250,
  });
  expect(await repository.get("activity-1")).toEqual(refreshed);
  expect(fetchActivitySnapshotMock).toHaveBeenCalledWith(
    "activity-1",
    undefined,
  );
});

it("304 复用已有记录且不重写 fetchedAt", async () => {
  let now = 200;
  const repository = new SnapshotRepository("user-1", () => now);
  const current = await repository.replace("activity-1", {
    etag: 'W/"2"',
    snapshot,
  } as never);
  now = 300;
  fetchActivitySnapshotMock.mockResolvedValue({
    status: "not-modified",
    value: { etag: current.etag, snapshot: current.snapshot },
  });

  await expect(repository.refresh("activity-1")).resolves.toEqual(current);
  expect(fetchActivitySnapshotMock).toHaveBeenCalledWith("activity-1", {
    etag: current.etag,
    snapshot: current.snapshot,
  });
  expect((await repository.get("activity-1"))?.fetchedAt).toBe(200);
});

it("没有缓存时 require 返回明确中文错误", async () => {
  await expect(
    new SnapshotRepository("user-1").require("missing"),
  ).rejects.toThrow("此活动尚未缓存，无法离线查看。");
});
