import "fake-indexeddb/auto";
import { afterEach, expect, test } from "vitest";
import { deleteDB } from "idb";
import { enqueueExpense } from "@/pwa/sync-queue/enqueue-expense";
import type { CreateExpenseRequest } from "@/features/expenses/contracts";
afterEach(() => deleteDB("huddletab:u1"));
const input: CreateExpenseRequest = {
  clientMutationId: "mutation-1",
  title: "晚餐",
  category: "FOOD",
  originalCurrency: "CNY",
  originalAmountMinor: "100",
  exchangeRate: "1",
  exchangeRateSource: "IDENTITY",
  exchangeRateAt: "2026-08-23T08:00:00.000Z",
  occurredAt: "2026-08-23T08:00:00.000Z",
  payments: [{ memberId: "m1", amountMinor: "100" }],
  split: { mode: "EQUAL" as const, members: ["m1"] },
};
test("一次 IndexedDB 事务保存同一 mutationId 和附件，且保留 clientMutationId", async () => {
  const result = await enqueueExpense({
    userId: "u1",
    activityId: "a1",
    baseCurrency: "CNY",
    input,
    files: [new File(["receipt"], "receipt.jpg", { type: "image/jpeg" })],
  });
  expect(result.mutation.payload.clientMutationId).toBe("mutation-1");
  expect(result.attachments).toHaveLength(1);
  expect(result.attachments[0]?.mutationId).toBe(result.mutation.id);
});
test("离线外币没有缓存或手工汇率时拒绝正式入队", async () => {
  await expect(
    enqueueExpense({
      userId: "u1",
      activityId: "a1",
      baseCurrency: "CNY",
      input: {
        ...input,
        originalCurrency: "JPY",
        exchangeRate: "",
        exchangeRateSource: "IDENTITY",
      },
      files: [],
    }),
  ).rejects.toThrow("离线外币消费需要有效缓存汇率或手工汇率");
});
