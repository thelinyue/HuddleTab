import "fake-indexeddb/auto";

import { deleteDB } from "idb";
import { afterEach, expect, it } from "vitest";

import { databaseName } from "./database";
import { MutationRepository } from "./mutation-repository";
import { pendingMutationFixture } from "./test-fixtures";

afterEach(() =>
  Promise.all([
    deleteDB(databaseName("user-1")),
    deleteDB(databaseName("user-2")),
  ]),
);

it("repository 注入当前 userId 并完整保存 Expense Create 输入", async () => {
  const repository = new MutationRepository("user-1");
  const input = pendingMutationFixture("mutation-1");

  const saved = await repository.put(input);

  expect(saved).toEqual({ ...input, userId: "user-1" });
  expect(await repository.get("mutation-1")).toEqual(saved);
});

it("不同 userId 的 queue 不可互读", async () => {
  const first = new MutationRepository("user-1");
  const second = new MutationRepository("user-2");
  await first.put(pendingMutationFixture("same-id"));

  expect(await second.get("same-id")).toBeUndefined();
});

it("按 activityId 隔离并使用 createdAt、id 提供确定顺序", async () => {
  const repository = new MutationRepository("user-1");
  await repository.put(
    pendingMutationFixture("b", { createdAt: 20 }),
  );
  await repository.put(
    pendingMutationFixture("c", {
      activityId: "activity-2",
      createdAt: 1,
    }),
  );
  await repository.put(
    pendingMutationFixture("a", { createdAt: 20 }),
  );

  expect(
    (await repository.listByActivity("activity-1")).map(({ id }) => id),
  ).toEqual(["a", "b"]);
});

it("全队列跨 activity 仍按 createdAt、id 提供确定顺序", async () => {
  const repository = new MutationRepository("user-1");
  await repository.put(
    pendingMutationFixture("b", { activityId: "activity-2", createdAt: 20 }),
  );
  await repository.put(
    pendingMutationFixture("c", { status: "REJECTED", createdAt: 30 }),
  );
  await repository.put(pendingMutationFixture("a", { createdAt: 20 }));

  expect((await repository.listAll()).map(({ id, status }) => [id, status]))
    .toEqual([
      ["a", "PENDING"],
      ["b", "PENDING"],
      ["c", "REJECTED"],
    ]);
});
