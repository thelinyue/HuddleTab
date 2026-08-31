import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  authorize: vi.fn(),
  lockActivity: vi.fn(),
  findByCreatorMutation: vi.fn(),
  insertAggregate: vi.fn(),
  insertAudit: vi.fn(),
  incrementRevision: vi.fn(),
}));

vi.mock("@/server/permissions/authorize-activity-operation", async (original) => ({
  ...(await original()),
  authorizeActivityOperation: mocks.authorize,
}));
vi.mock("@/server/repositories/expense-repository", () => ({
  ExpenseRepository: class {
    lockActivity = mocks.lockActivity;
    findByCreatorMutation = mocks.findByCreatorMutation;
    insertAggregate = mocks.insertAggregate;
    insertAudit = mocks.insertAudit;
    incrementRevision = mocks.incrementRevision;
  },
}));

import { ExpenseService } from "@/server/services/expense-service";

it("创建 Expense 先锁活动行再读取主币种授权事实", async () => {
  mocks.order.length = 0;
  mocks.lockActivity.mockImplementation(async () => {
    mocks.order.push("lock");
  });
  mocks.authorize.mockImplementation(async () => {
    mocks.order.push("authorize");
    return {
      userId: "user-1",
      activity: {
        id: "activity-1",
        status: "ACTIVE",
        deletedAt: null,
        baseCurrency: "CNY",
        revision: 0n,
      },
      member: { id: "member-1", role: "OWNER", status: "ACTIVE" },
    };
  });
  mocks.findByCreatorMutation.mockResolvedValue(null);
  mocks.insertAggregate.mockResolvedValue({ id: "expense-1" });
  const transaction = vi.fn().mockResolvedValue([]);
  const sql = {
    begin: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  };

  await new ExpenseService(sql as never).create(
    { user: { id: "user-1" } },
    "activity-1",
    {
      clientMutationId: "mutation-1",
      title: "晚餐",
      category: "FOOD",
      originalCurrency: "CNY",
      originalAmountMinor: "1000",
      exchangeRate: "1",
      exchangeRateSource: "IDENTITY",
      exchangeRateAt: "2026-08-31T08:00:00.000Z",
      occurredAt: "2026-08-31T08:00:00.000Z",
      payments: [{ memberId: "member-1", amountMinor: "1000" }],
      split: { mode: "EQUAL", members: ["member-1"] },
    },
  );

  expect(mocks.order.slice(0, 2)).toEqual(["lock", "authorize"]);
});
