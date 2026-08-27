import { expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  getEntryContext: vi.fn(),
  assertWritesAllowed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  sessionUserId: vi.fn().mockReturnValue("user-1"),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/maintenance/maintenance-mode", () => ({
  MaintenanceMode: class {
    assertWritesAllowed = mocks.assertWritesAllowed;
  },
}));
vi.mock("@/server/services/expense-service", () => ({
  ExpenseService: class {
    create = mocks.create;
    update = mocks.update;
    remove = mocks.remove;
    list = mocks.list;
    get = mocks.get;
    getEntryContext = mocks.getEntryContext;
  },
}));

import {
  GET as listExpenses,
  POST,
} from "@/app/api/activities/[activityId]/expenses/route";
import {
  DELETE,
  GET as getExpense,
  PUT,
} from "@/app/api/activities/[activityId]/expenses/[expenseId]/route";
import { GET as getEntryContext } from "@/app/api/activities/[activityId]/expenses/entry-context/route";

const context = { params: Promise.resolve({ activityId: "activity-1" }) };
const itemContext = {
  params: Promise.resolve({ activityId: "activity-1", expenseId: "expense-1" }),
};
const validRequest = {
  clientMutationId: "01JEXPENSERETRY0000000001",
  title: "晚餐",
  category: "FOOD",
  originalCurrency: "CNY",
  originalAmountMinor: "1000",
  exchangeRate: "1",
  exchangeRateSource: "IDENTITY",
  exchangeRateAt: "2026-08-23T08:00:00.000Z",
  occurredAt: "2026-08-23T08:00:00.000Z",
  payments: [{ memberId: "member-1", amountMinor: "1000" }],
  split: { mode: "EQUAL", members: ["member-1"] },
};
const expense = {
  id: "expense-1",
  activity_id: "activity-1",
  title: "晚餐",
  category: "FOOD",
  original_currency: "CNY",
  original_amount_minor: 1000n,
  base_currency: "CNY",
  base_amount_minor: 1000n,
  exchange_rate: "1",
  exchange_rate_source: "IDENTITY",
  exchange_rate_at: new Date("2026-08-23T08:00:00.000Z"),
  split_mode: "EQUAL",
  occurred_at: new Date("2026-08-23T08:00:00.000Z"),
  note: null,
  created_by_member_id: "member-1",
  created_by_user_id: "user-1",
  created_by_display_name: "小李",
  client_mutation_id: "01JEXPENSERETRY0000000001",
  version: 1,
  created_at: new Date("2026-08-23T08:00:00.000Z"),
  updated_at: new Date("2026-08-23T08:00:00.000Z"),
};

it("POST 返回 JSON 安全金额，幂等重放返回 200", async () => {
  mocks.create
    .mockResolvedValueOnce({ expense, idempotentReplay: false })
    .mockResolvedValueOnce({ expense, idempotentReplay: true });

  const first = await POST(
    new Request("http://localhost/api/activities/activity-1/expenses", {
      method: "POST",
      body: JSON.stringify(validRequest),
    }),
    context,
  );
  const replay = await POST(
    new Request("http://localhost/api/activities/activity-1/expenses", {
      method: "POST",
      body: JSON.stringify(validRequest),
    }),
    context,
  );

  expect(first.status).toBe(201);
  expect((await first.json()).data).toMatchObject({
    idempotentReplay: false,
    expense: { baseAmountMinor: "1000" },
  });
  expect(replay.status).toBe(200);
  expect((await replay.json()).data.idempotentReplay).toBe(true);
});

it("列表与详情只返回 JSON 安全的费用事实", async () => {
  mocks.list.mockResolvedValue([expense]);
  mocks.get.mockResolvedValue({
    expense,
    payments: [],
    shares: [],
    attachments: [
      {
        id: "attachment-1",
        safe_filename: "receipt.webp",
        mime_type: "image/webp",
        width: 1,
        height: 1,
        byte_size: 44n,
        sha256: "a".repeat(64),
        created_at: "2026-08-23T08:00:00.000Z",
      },
    ],
    permissions: { canUpdate: false, canDelete: false },
  });

  const list = await listExpenses(
    new Request(
      "http://localhost/api/activities/activity-1/expenses?query=%E6%99%9A&category=FOOD&mine=true",
    ),
    context,
  );
  const detail = await getExpense(
    new Request(
      "http://localhost/api/activities/activity-1/expenses/expense-1",
    ),
    itemContext,
  );

  expect(list.status).toBe(200);
  expect((await list.json()).data[0]).toMatchObject({
    originalAmountMinor: "1000",
    version: 1,
  });
  expect(detail.status).toBe(200);
  const detailBody = await detail.json();
  expect(detailBody.data.expense).toMatchObject({
    id: "expense-1",
    createdByDisplayName: "小李",
  });
  expect(detailBody.data).toMatchObject({
    permissions: { canUpdate: false, canDelete: false },
    attachments: [
      { id: "attachment-1", createdAt: "2026-08-23T08:00:00.000Z" },
    ],
  });
  expect(mocks.list).toHaveBeenCalledWith(
    { user: { id: "user-1" } },
    "activity-1",
    { query: "晚", category: "FOOD", mine: true },
  );
});

it("快速记账上下文只返回活动身份与当前用户偏好", async () => {
  mocks.getEntryContext.mockResolvedValue({
    activity: {
      id: "activity-1",
      baseCurrency: "CNY",
      status: "ENDED",
      currentMemberId: "member-1",
      currentUserId: "user-1",
    },
    members: [{ id: "member-1", displayName: "小李", status: "ACTIVE" }],
    preference: {
      lastCategory: "FOOD",
      recentParticipantIds: ["member-1"],
      recentPayerIds: ["member-1"],
      recentCurrency: "CNY",
      recentTitles: ["晚餐"],
    },
    permissions: { canCreateExpense: true },
  });

  const response = await getEntryContext(
    new Request(
      "http://localhost/api/activities/activity-1/expenses/entry-context",
    ),
    context,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: {
      activity: {
        currentMemberId: "member-1",
        currentUserId: "user-1",
        status: "ENDED",
      },
      members: [{ displayName: "小李" }],
      permissions: { canCreateExpense: true },
    },
  });
  expect(mocks.getEntryContext).toHaveBeenCalledWith(
    { user: { id: "user-1" } },
    "activity-1",
  );
});

it("PUT 映射版本冲突，DELETE 接受版本并返回 204", async () => {
  mocks.update.mockRejectedValueOnce(
    new ApplicationError(
      "VERSION_CONFLICT",
      "这笔消费已被其他人修改，请刷新后重试",
      409,
    ),
  );
  mocks.remove.mockResolvedValueOnce(undefined);

  const conflict = await PUT(
    new Request(
      "http://localhost/api/activities/activity-1/expenses/expense-1",
      {
        method: "PUT",
        body: JSON.stringify({ ...validRequest, version: 1 }),
      },
    ),
    itemContext,
  );
  const removed = await DELETE(
    new Request(
      "http://localhost/api/activities/activity-1/expenses/expense-1",
      {
        method: "DELETE",
        body: JSON.stringify({ version: 1 }),
      },
    ),
    itemContext,
  );

  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({
    error: { code: "VERSION_CONFLICT" },
  });
  expect(removed.status).toBe(204);
  expect(mocks.remove).toHaveBeenCalledWith(
    { user: { id: "user-1" } },
    "activity-1",
    "expense-1",
    1,
  );
});

it("LEFT 写入与输入校验错误返回稳定的错误契约", async () => {
  mocks.update.mockRejectedValueOnce(
    new ApplicationError(
      "EXPENSE_READ_ONLY_FOR_LEFT",
      "你已退出活动，历史消费仅可查看。",
      403,
    ),
  );

  const forbidden = await PUT(
    new Request(
      "http://localhost/api/activities/activity-1/expenses/expense-1",
      {
        method: "PUT",
        body: JSON.stringify({ ...validRequest, version: 1 }),
      },
    ),
    itemContext,
  );
  const invalid = await POST(
    new Request("http://localhost/api/activities/activity-1/expenses", {
      method: "POST",
      body: JSON.stringify({}),
    }),
    context,
  );

  expect(forbidden.status).toBe(403);
  expect(await forbidden.json()).toMatchObject({
    error: { code: "EXPENSE_READ_ONLY_FOR_LEFT" },
  });
  expect(invalid.status).toBe(422);
  expect(await invalid.json()).toMatchObject({
    error: { code: "VALIDATION_ERROR", fieldErrors: expect.any(Object) },
  });
});
