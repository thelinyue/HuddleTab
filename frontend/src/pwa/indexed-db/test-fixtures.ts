import type { PendingExpenseMutation } from "./schema";

export const expensePayload: PendingExpenseMutation["payload"] = {
  category: "FOOD",
  clientMutationId: "mutation-client-1",
  exchangeRate: "1",
  exchangeRateKind: "IDENTITY",
  occurredAt: "2026-09-01T08:00:00Z",
  originalAmountMinor: "100",
  originalCurrency: "CNY",
  payments: [{ memberId: "member-1", amountMinor: "100" }],
  split: { mode: "EQUAL", members: ["member-1"] },
  title: "早餐",
};

export function pendingMutationFixture(
  id: string,
  overrides: Partial<Omit<PendingExpenseMutation, "id" | "userId">> = {},
): Omit<PendingExpenseMutation, "userId"> {
  return {
    id,
    activityId: "activity-1",
    kind: "CREATE_EXPENSE",
    payload: expensePayload,
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: 10,
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}
