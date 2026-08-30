import "fake-indexeddb/auto";
import { afterEach, expect, test } from "vitest";
import { vi } from "vitest";
import { deleteDB } from "idb";
import { enqueueExpense } from "@/pwa/sync-queue/enqueue-expense";
import type { CreateExpenseRequest } from "@/features/expenses/contracts";
afterEach(() => {
  vi.unstubAllGlobals();
  return deleteDB("huddletab:u1");
});
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

test("浏览器没有 crypto.randomUUID 时离线入队仍生成 UUID 格式的本地 ID", async () => {
  let seed = 0;
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.forEach((_, index) => {
        bytes[index] = (seed + index) % 256;
      });
      seed += bytes.length;
      return bytes;
    },
  });

  const result = await enqueueExpense({
    userId: "u1",
    activityId: "a1",
    baseCurrency: "CNY",
    input,
    files: [new File(["receipt"], "receipt.jpg", { type: "image/jpeg" })],
  });

  expect(result.mutation.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(result.attachments[0]?.id).not.toBe(result.mutation.id);
  expect(result.attachments[0]?.clientAttachmentId).not.toBe(
    result.attachments[0]?.id,
  );
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
