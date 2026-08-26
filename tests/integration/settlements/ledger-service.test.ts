import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";
import { LedgerService } from "@/server/services/ledger-service";

let harness: PostgresHarness;
let activityId: string;
const session = { user: { id: "ledger-user" } };

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser(session.user.id, "ledger@example.com");
  const activity = await new ActivityService(harness.sql).create({
    session,
    name: "总账活动",
    baseCurrency: "CNY",
    startDate: "2026-08-23",
    ownerDisplayName: "Owner",
  });
  activityId = activity.id;
});

afterAll(async () => {
  await harness?.stop();
});

it("空活动仍返回所有账务成员的守恒余额", async () => {
  await expect(
    new LedgerService(harness.sql).getBalances(session, activityId),
  ).resolves.toMatchObject({
    activityId,
    currency: "CNY",
    balances: [{ netMinor: "0" }],
  });
});

it("从消费与实际结算事实计算余额，并将金额序列化为字符串", async () => {
  const secondUserId = "ledger-second-user";
  const secondMemberId = randomUUID();
  const expenseId = randomUUID();
  await harness.seedCredentialUser(secondUserId, "ledger-second@example.com");
  const [owner] =
    await harness.sql`select id from activity_members where activity_id = ${activityId} and user_id = ${session.user.id}`;
  await harness.sql`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at)
    values (${secondMemberId}, ${activityId}, ${secondUserId}, 'Second', 'USER', 'MEMBER', 'ACTIVE', now())`;
  await harness.sql`insert into expenses (id, activity_id, title, category, original_currency, original_amount_minor, base_currency, base_amount_minor, exchange_rate, exchange_rate_source, exchange_rate_at, split_mode, occurred_at, created_by_member_id, created_by_user_id, client_mutation_id, version)
    values (${expenseId}, ${activityId}, '晚餐', 'FOOD', 'CNY', 900, 'CNY', 900, 1, 'IDENTITY', now(), 'EQUAL', now(), ${owner!.id}, ${session.user.id}, ${randomUUID()}, 1)`;
  await harness.sql`insert into expense_payments (expense_id, activity_member_id, original_amount_minor, base_amount_minor)
    values (${expenseId}, ${owner!.id}, 900, 900)`;
  await harness.sql`insert into expense_shares (expense_id, activity_member_id, split_input_minor, original_amount_minor, base_amount_minor)
    values (${expenseId}, ${secondMemberId}, null, 900, 900)`;
  await harness.sql`insert into settlements (id, activity_id, payer_member_id, receiver_member_id, amount_minor, currency, occurred_at, created_by_member_id, version)
    values (${randomUUID()}, ${activityId}, ${secondMemberId}, ${owner!.id}, 200, 'CNY', now(), ${secondMemberId}, 1)`;

  await expect(
    new LedgerService(harness.sql).getBalances(session, activityId),
  ).resolves.toMatchObject({
    balances: expect.arrayContaining([
      { memberId: owner!.id, netMinor: "700" },
      { memberId: secondMemberId, netMinor: "-700" },
    ]),
  });
});
