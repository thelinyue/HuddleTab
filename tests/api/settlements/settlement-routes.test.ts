import { expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  sessionUserId: vi.fn().mockReturnValue("user-1"),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/services/settlement-service", () => ({
  SettlementService: class {
    list = mocks.list;
    create = mocks.create;
    update = mocks.update;
    remove = mocks.remove;
  },
}));

import { POST } from "@/app/api/activities/[activityId]/settlements/route";
import {
  DELETE,
  PUT,
} from "@/app/api/activities/[activityId]/settlements/[settlementId]/route";

const context = { params: Promise.resolve({ activityId: "activity-1" }) };
const itemContext = {
  params: Promise.resolve({
    activityId: "activity-1",
    settlementId: "settlement-1",
  }),
};
const input = {
  payerMemberId: "member-1",
  receiverMemberId: "member-2",
  amountMinor: "1200",
  occurredAt: "2026-08-23T08:00:00.000Z",
  confirmOverSettlement: false,
};
const settlement = {
  id: "settlement-1",
  activity_id: "activity-1",
  payer_member_id: "member-1",
  receiver_member_id: "member-2",
  amount_minor: 1200n,
  currency: "CNY",
  occurred_at: new Date("2026-08-23T08:00:00.000Z"),
  note: null,
  created_by_member_id: "member-1",
  version: 1,
  created_at: new Date(),
  updated_at: new Date(),
};

it("超额创建返回可确认的 409", async () => {
  mocks.create.mockRejectedValueOnce(
    new ApplicationError(
      "OVER_SETTLEMENT_CONFIRMATION_REQUIRED",
      "需要确认",
      409,
      { currentPayableMinor: "1000", overAmountMinor: "200" },
    ),
  );
  const response = await POST(
    new Request("http://localhost/api/activities/activity-1/settlements", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    context,
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: {
      code: "OVER_SETTLEMENT_CONFIRMATION_REQUIRED",
      details: { overAmountMinor: "200" },
    },
  });
});

it("确认后的创建返回 JSON 安全金额", async () => {
  mocks.create.mockResolvedValueOnce({ settlement });
  const response = await POST(
    new Request("http://localhost/api/activities/activity-1/settlements", {
      method: "POST",
      body: JSON.stringify({ ...input, confirmOverSettlement: true }),
    }),
    context,
  );
  expect(response.status).toBe(201);
  expect((await response.json()).data.settlement.amountMinor).toBe("1200");
});

it("PUT 映射版本冲突且 DELETE 转发版本", async () => {
  mocks.update.mockRejectedValueOnce(
    new ApplicationError("VERSION_CONFLICT", "冲突", 409),
  );
  mocks.remove.mockResolvedValueOnce(undefined);
  const update = await PUT(
    new Request(
      "http://localhost/api/activities/activity-1/settlements/settlement-1",
      { method: "PUT", body: JSON.stringify({ ...input, version: 1 }) },
    ),
    itemContext,
  );
  const remove = await DELETE(
    new Request(
      "http://localhost/api/activities/activity-1/settlements/settlement-1",
      { method: "DELETE", body: JSON.stringify({ version: 1 }) },
    ),
    itemContext,
  );
  expect(update.status).toBe(409);
  expect(remove.status).toBe(204);
  expect(mocks.remove).toHaveBeenCalledWith(
    { user: { id: "user-1" } },
    "activity-1",
    "settlement-1",
    1,
  );
});
