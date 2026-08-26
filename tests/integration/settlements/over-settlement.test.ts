import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";
import { SettlementService } from "@/server/services/settlement-service";

let harness: PostgresHarness;
let activityId: string;
let creditorMemberId: string;
let payerMemberId: string;
const ownerSession = { user: { id: "over-owner" } };
const payerSession = { user: { id: "over-payer" } };

function request(amountMinor: string, confirmOverSettlement = false) {
  return {
    payerMemberId,
    receiverMemberId: creditorMemberId,
    amountMinor,
    occurredAt: "2026-08-23T08:00:00.000Z",
    confirmOverSettlement,
  };
}

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser(
    ownerSession.user.id,
    "over-owner@example.com",
  );
  await harness.seedCredentialUser(
    payerSession.user.id,
    "over-payer@example.com",
  );
  const activity = await new ActivityService(harness.sql).create({
    session: ownerSession,
    name: "超额结算活动",
    baseCurrency: "CNY",
    startDate: "2026-08-23",
    ownerDisplayName: "Owner",
  });
  activityId = activity.id;
  creditorMemberId = activity.ownerMemberId;
  payerMemberId = randomUUID();
  await harness.sql`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at)
    values (${payerMemberId}, ${activityId}, ${payerSession.user.id}, 'Payer', 'USER', 'MEMBER', 'ACTIVE', now())`;
  const expenseId = randomUUID();
  await harness.sql`insert into expenses (id, activity_id, title, category, original_currency, original_amount_minor, base_currency, base_amount_minor, exchange_rate, exchange_rate_source, exchange_rate_at, split_mode, occurred_at, created_by_member_id, created_by_user_id, client_mutation_id, version)
    values (${expenseId}, ${activityId}, '晚餐', 'FOOD', 'CNY', 32650, 'CNY', 32650, 1, 'IDENTITY', now(), 'EQUAL', now(), ${creditorMemberId}, ${ownerSession.user.id}, ${randomUUID()}, 1)`;
  await harness.sql`insert into expense_payments (expense_id, activity_member_id, original_amount_minor, base_amount_minor)
    values (${expenseId}, ${creditorMemberId}, 32650, 32650)`;
  await harness.sql`insert into expense_shares (expense_id, activity_member_id, split_input_minor, original_amount_minor, base_amount_minor)
    values (${expenseId}, ${payerMemberId}, null, 32650, 32650)`;
});

afterAll(async () => {
  await harness?.stop();
});

it("服务器重算超额并在确认后忠实保存实际金额", async () => {
  const service = new SettlementService(harness.sql);
  await expect(
    service.create(payerSession, activityId, request("40000")),
  ).rejects.toMatchObject({
    status: 409,
    code: "OVER_SETTLEMENT_CONFIRMATION_REQUIRED",
    details: { currentPayableMinor: "32650", overAmountMinor: "7350" },
  });
  await expect(
    service.create(payerSession, activityId, request("40000", true)),
  ).resolves.toMatchObject({ settlement: { amount_minor: "40000" } });
});

it("当前推荐为零仍可记录确认后的真实 Settlement", async () => {
  await expect(
    new SettlementService(harness.sql).create(
      payerSession,
      activityId,
      request("100", true),
    ),
  ).resolves.toBeDefined();
});
