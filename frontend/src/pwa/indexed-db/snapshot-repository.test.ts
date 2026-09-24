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

it.each(["modified", "not-modified"])("删除后晚到的 %s 快照不能恢复缓存", async (status) => {
  const repository = new SnapshotRepository("user-1");
  await repository.replace("activity-1", { etag: "1", snapshot } as never);
  let respond!: (value: unknown) => void;
  fetchActivitySnapshotMock.mockReturnValue(new Promise((resolve) => { respond = resolve; }));
  const refresh = repository.refresh("activity-1");
  await vi.waitFor(() => expect(fetchActivitySnapshotMock).toHaveBeenCalledTimes(1));
  await new SnapshotRepository("user-1").forgetUnavailable("activity-1");
  const rejected = expect(refresh).rejects.toMatchObject({ status: 404 });
  respond({ status, value: { etag: "1", snapshot } });
  await rejected;
  expect(await repository.get("activity-1")).toBeUndefined();
});

it("404 清除快照并保留被拒绝的草稿与附件，不影响其他活动", async () => {
  const { ApiRequestError } = await import("../../api/error");
  const { MutationRepository } = await import("./mutation-repository");
  const { AttachmentRepository } = await import("./attachment-repository");
  const { pendingMutationFixture } = await import("./test-fixtures");
  const repository = new SnapshotRepository("user-1");
  const mutations = new MutationRepository("user-1");
  const attachments = new AttachmentRepository("user-1");
  await repository.replace("activity-1", { etag: "1", snapshot } as never);
  await repository.replace("other", { etag: "2", snapshot } as never);
  await mutations.enqueueWithAttachments(pendingMutationFixture("draft"), [{
    id: "image", clientAttachmentId: "image-client", fileName: "receipt.webp", mimeType: "image/webp", blob: new Blob(["receipt"], { type: "image/webp" }),
  }]);
  await mutations.put(pendingMutationFixture("other-draft", { activityId: "other" }));
  fetchActivitySnapshotMock.mockRejectedValue(new ApiRequestError(404));
  await expect(repository.refresh("activity-1")).rejects.toMatchObject({ status: 404 });
  expect(await repository.get("activity-1")).toBeUndefined();
  expect(await repository.get("other")).toBeDefined();
  expect(await mutations.get("draft")).toMatchObject({ status: "REJECTED", lastError: { code: "ACTIVITY_UNAVAILABLE" }, payload: { title: "早餐" } });
  expect(await mutations.get("other-draft")).toMatchObject({ status: "PENDING" });
  const image = (await attachments.listByMutation("draft"))[0];
  expect(image).toMatchObject({ status: "REJECTED", fileName: "receipt.webp" });
  expect(image.blob.size).toBe(7);
  await expect(mutations.reviseRejected("draft", (await mutations.get("draft"))!.payload, [])).rejects.toThrow("无法同步");
});
