import "fake-indexeddb/auto";

import { afterEach, expect, test, vi } from "vitest";
import { deleteDB } from "idb";
import { MutationRepository } from "@/pwa/indexed-db/mutation-repository";
import { syncForegroundQueue } from "@/pwa/sync-queue/sync-triggers";

afterEach(async () => {
  await deleteDB("huddletab:u1");
});

test("前台同步仅处理当前用户的到期消费队列", async () => {
  const queue = new MutationRepository("u1", () => 0);
  await queue.add({
    id: "mutation-1",
    activityId: "activity-1",
    kind: "CREATE_EXPENSE",
    payload: {} as never,
  });
  const createExpense = vi.fn().mockResolvedValue({
    expense: { id: "expense-1" },
  });

  await syncForegroundQueue("u1", createExpense);

  expect(createExpense).toHaveBeenCalledWith("activity-1", {});
  expect((await queue.get("mutation-1"))?.status).toBe("SYNCED");
});
