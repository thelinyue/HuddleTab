import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";
import { ExpenseService } from "@/server/services/expense-service";
import { NotificationService } from "@/server/services/notification-service";
import { SettlementService } from "@/server/services/settlement-service";

let harness: PostgresHarness;
const ownerSession = { user: { id: "notification-events-owner" } };
const participantSession = { user: { id: "notification-events-participant" } };

function expenseRequest(
  payerMemberId: string,
  participantMemberIds: readonly string[],
) {
  return {
    clientMutationId: randomUUID(),
    title: "晚餐",
    category: "FOOD",
    originalCurrency: "CNY",
    originalAmountMinor: "1000",
    exchangeRate: "1",
    exchangeRateSource: "IDENTITY" as const,
    exchangeRateAt: "2026-08-23T08:00:00.000Z",
    occurredAt: "2026-08-23T08:00:00.000Z",
    payments: [{ memberId: payerMemberId, amountMinor: "1000" }],
    split: { mode: "EQUAL" as const, members: participantMemberIds },
  };
}

async function createActivity(name: string) {
  const activity = await new ActivityService(harness.sql).create({
    session: ownerSession,
    name,
    baseCurrency: "CNY",
    startDate: "2026-08-23",
    ownerDisplayName: "Owner",
  });
  const participantMemberId = randomUUID();
  await harness.sql`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at)
    values (${participantMemberId}, ${activity.id}, ${participantSession.user.id}, 'Participant', 'USER', 'MEMBER', 'ACTIVE', now())`;
  return { ...activity, participantMemberId };
}

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser(ownerSession.user.id, "owner@example.com");
  await harness.seedCredentialUser(
    participantSession.user.id,
    "participant@example.com",
  );
});

afterAll(async () => {
  await harness?.stop();
});

it("消费更新通知修改前的其他参与账号，普通新增消费不通知", async () => {
  const activity = await createActivity("消费更新通知活动");
  const service = new ExpenseService(harness.sql);
  const created = await service.create(
    ownerSession,
    activity.id,
    expenseRequest(activity.participantMemberId, [
      activity.ownerMemberId,
      activity.participantMemberId,
    ]),
  );

  expect(
    await harness.sql`select id from notifications where target_id = ${created.expense.id}`,
  ).toHaveLength(0);

  await service.update(ownerSession, activity.id, created.expense.id, {
    ...expenseRequest(activity.ownerMemberId, [activity.ownerMemberId]),
    version: 1,
  });

  const notifications = await harness.sql`
    select recipient_user_id, type, target_type, target_id from notifications
    where target_id = ${created.expense.id}`;
  expect(notifications).toEqual([
    {
      recipient_user_id: participantSession.user.id,
      type: "PARTICIPATING_EXPENSE_CHANGED",
      target_type: "EXPENSE",
      target_id: created.expense.id,
    },
  ]);
  expect(
    (
      await new NotificationService(harness.sql).list(
        participantSession.user.id,
      )
    ).items.find((item) => item.targetId === created.expense.id),
  ).toMatchObject({ activityId: activity.id });
});

it("消费删除通知其他参与账号", async () => {
  const activity = await createActivity("消费删除通知活动");
  const service = new ExpenseService(harness.sql);
  const created = await service.create(
    ownerSession,
    activity.id,
    expenseRequest(activity.ownerMemberId, [
      activity.ownerMemberId,
      activity.participantMemberId,
    ]),
  );

  await service.remove(ownerSession, activity.id, created.expense.id, 1);

  const notifications = await harness.sql`
    select recipient_user_id, type, target_type, target_id from notifications
    where target_id = ${created.expense.id}`;
  expect(notifications).toEqual([
    {
      recipient_user_id: participantSession.user.id,
      type: "PARTICIPATING_EXPENSE_DELETED",
      target_type: "EXPENSE",
      target_id: created.expense.id,
    },
  ]);
  expect(
    (
      await new NotificationService(harness.sql).list(
        participantSession.user.id,
      )
    ).items.find((item) => item.targetId === created.expense.id),
  ).toMatchObject({ activityId: activity.id });
});

it("结算只通知收款账号", async () => {
  const activity = await createActivity("结算收款通知活动");
  const settlement = await new SettlementService(harness.sql).create(
    participantSession,
    activity.id,
    {
      payerMemberId: activity.participantMemberId,
      receiverMemberId: activity.ownerMemberId,
      amountMinor: "100",
      occurredAt: "2026-08-23T08:00:00.000Z",
      confirmOverSettlement: true,
    },
  );

  const notifications = await harness.sql`
    select recipient_user_id, type, target_type, target_id from notifications
    where target_id = ${settlement.settlement.id}`;
  expect(notifications).toEqual([
    {
      recipient_user_id: ownerSession.user.id,
      type: "SETTLEMENT_RECEIVED",
      target_type: "SETTLEMENT",
      target_id: settlement.settlement.id,
    },
  ]);
});
