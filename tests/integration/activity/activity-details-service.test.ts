import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityDetailsService } from "@/server/services/activity-details-service";
import { ActivityService } from "@/server/services/activity-service";
import { ExpenseService } from "@/server/services/expense-service";

let harness: PostgresHarness;
let activityId: string;
const ownerSession = { user: { id: "details-owner" } };
const adminSession = { user: { id: "details-admin" } };
const memberSession = { user: { id: "details-member" } };
const leftSession = { user: { id: "details-left" } };

async function createActivity(name = `活动-${randomUUID()}`) {
  return new ActivityService(harness.sql).create({
    session: ownerSession,
    name,
    location: "日本大阪",
    baseCurrency: "CNY",
    startDate: "2026-08-20",
    endDate: "2026-09-03",
    ownerDisplayName: "Owner",
  });
}

async function insertExpense(input: {
  readonly activityId: string;
  readonly ownerMemberId: string;
  readonly deleted?: boolean;
  readonly occurredAt?: string;
}) {
  const id = randomUUID();
  await harness.sql`insert into expenses
    (id, activity_id, title, category, original_currency, original_amount_minor,
     base_currency, base_amount_minor, exchange_rate, exchange_rate_source,
     exchange_rate_at, split_mode, occurred_at, created_by_member_id,
     created_by_user_id, client_mutation_id, version, deleted_at, deleted_by_member_id)
    values
    (${id}, ${input.activityId}, '民宿', 'LODGING', 'CNY', 2800,
     'CNY', 2800, 1, 'IDENTITY', now(), 'EQUAL',
     ${input.occurredAt ?? "2026-08-25T08:00:00.000Z"}, ${input.ownerMemberId},
     ${ownerSession.user.id}, ${randomUUID()}, 1,
     ${input.deleted ? new Date().toISOString() : null}, ${input.deleted ? input.ownerMemberId : null})`;
  return id;
}

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser("details-owner", "details-owner@example.com");
  await harness.seedCredentialUser("details-admin", "details-admin@example.com");
  await harness.seedCredentialUser("details-member", "details-member@example.com");
  await harness.seedCredentialUser("details-left", "details-left@example.com");
  activityId = (
    await new ActivityService(harness.sql).create({
      session: ownerSession,
      name: "大阪行",
      location: "日本大阪",
      baseCurrency: "CNY",
      startDate: "2026-08-31",
      endDate: "2026-09-03",
      ownerDisplayName: "Owner",
    })
  ).id;
});

afterAll(async () => {
  await harness?.stop();
});

it("返回 ACTIVE Owner 的活动字段、账务摘要和字段级编辑权限", async () => {
  const details = await new ActivityDetailsService(harness.sql).get(
    ownerSession,
    activityId,
  );

  expect(details).toEqual({
    id: activityId,
    name: "大阪行",
    location: "日本大阪",
    baseCurrency: "CNY",
    startDate: "2026-08-31",
    endDate: "2026-09-03",
    status: "ACTIVE",
    revision: "0",
    currentMemberRole: "OWNER",
    currentMemberStatus: "ACTIVE",
    hasAccountingRecords: false,
    earliestExpenseDate: null,
    permissions: {
      name: true,
      location: true,
      baseCurrency: true,
      startDate: true,
      endDate: true,
    },
  });
});

it("无账务时修改主币种并只审计实际变化字段", async () => {
  const activity = await createActivity();
  const result = await new ActivityDetailsService(harness.sql).update(
    ownerSession,
    activity.id,
    { revision: "0", baseCurrency: "JPY", location: null },
  );

  expect(result.activity).toMatchObject({
    baseCurrency: "JPY",
    location: null,
    revision: "1",
  });
  const [audit] = await harness.sql`
    select metadata
    from activity_audit_logs
    where activity_id = ${activity.id} and event_type = 'ACTIVITY_UPDATED'`;
  expect(audit?.metadata).toEqual({
    changes: {
      location: { before: "日本大阪", after: null },
      baseCurrency: { before: "CNY", after: "JPY" },
    },
  });
});

it("软删除 Expense 或 Settlement 仍永久锁定主币种", async () => {
  const expenseActivity = await createActivity();
  await insertExpense({
    activityId: expenseActivity.id,
    ownerMemberId: expenseActivity.ownerMemberId,
    deleted: true,
  });
  await expect(
    new ActivityDetailsService(harness.sql).update(
      ownerSession,
      expenseActivity.id,
      { revision: "0", baseCurrency: "JPY" },
    ),
  ).rejects.toMatchObject({ code: "BASE_CURRENCY_LOCKED" });

  const settlementActivity = await createActivity();
  const temporaryMemberId = randomUUID();
  await harness.sql`insert into activity_members
    (id, activity_id, user_id, display_name, member_type, role, status, joined_at)
    values (${temporaryMemberId}, ${settlementActivity.id}, null, '临时成员', 'GUEST', 'MEMBER', 'ACTIVE', now())`;
  await harness.sql`insert into settlements
    (id, activity_id, payer_member_id, receiver_member_id, amount_minor,
     currency, occurred_at, created_by_member_id, version, deleted_at, deleted_by_member_id)
    values (${randomUUID()}, ${settlementActivity.id}, ${settlementActivity.ownerMemberId},
      ${temporaryMemberId}, 100, 'CNY', now(), ${settlementActivity.ownerMemberId},
      1, now(), ${settlementActivity.ownerMemberId})`;
  await expect(
    new ActivityDetailsService(harness.sql).update(
      ownerSession,
      settlementActivity.id,
      { revision: "0", baseCurrency: "JPY" },
    ),
  ).rejects.toMatchObject({ code: "BASE_CURRENCY_LOCKED" });
});

it("角色和生命周期共同决定字段权限，成员与 LEFT 无法更新", async () => {
  const activity = await createActivity();
  const memberships = [
    [adminSession.user.id, "ADMIN", "ACTIVE"],
    [memberSession.user.id, "MEMBER", "ACTIVE"],
    [leftSession.user.id, "ADMIN", "LEFT"],
  ] as const;
  for (const [userId, role, status] of memberships) {
    await harness.sql`insert into activity_members
      (id, activity_id, user_id, display_name, member_type, role, status, joined_at, left_at)
      values (${randomUUID()}, ${activity.id}, ${userId}, ${userId}, 'USER', ${role},
        ${status}, now(), ${status === "LEFT" ? new Date().toISOString() : null})`;
  }

  expect(
    (await new ActivityDetailsService(harness.sql).get(adminSession, activity.id))
      .permissions,
  ).toEqual({
    name: true,
    location: true,
    baseCurrency: true,
    startDate: true,
    endDate: true,
  });
  for (const session of [memberSession, leftSession]) {
    await expect(
      new ActivityDetailsService(harness.sql).update(session, activity.id, {
        revision: "0",
        name: "越权修改",
      }),
    ).rejects.toMatchObject({ code: "ROLE_FORBIDDEN" });
  }

  await harness.sql`update activities set status = 'ENDED' where id = ${activity.id}`;
  expect(
    (await new ActivityDetailsService(harness.sql).get(ownerSession, activity.id))
      .permissions,
  ).toEqual({
    name: true,
    location: true,
    baseCurrency: false,
    startDate: false,
    endDate: false,
  });
  await harness.sql`update activities set status = 'ARCHIVED' where id = ${activity.id}`;
  expect(
    Object.values(
      (await new ActivityDetailsService(harness.sql).get(ownerSession, activity.id))
        .permissions,
    ),
  ).toEqual([false, false, false, false, false]);
});

it("日期范围校验、revision 冲突和早于消费日期警告使用真实持久化事实", async () => {
  const activity = await createActivity();
  await insertExpense({
    activityId: activity.id,
    ownerMemberId: activity.ownerMemberId,
    occurredAt: "2026-08-25T08:00:00.000Z",
  });

  await expect(
    new ActivityDetailsService(harness.sql).update(ownerSession, activity.id, {
      revision: "9",
      name: "旧客户端",
    }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    new ActivityDetailsService(harness.sql).update(ownerSession, activity.id, {
      revision: "0",
      startDate: "2026-09-05",
    }),
  ).rejects.toMatchObject({ code: "INVALID_ACTIVITY_DATE_RANGE" });

  const result = await new ActivityDetailsService(harness.sql).update(
    ownerSession,
    activity.id,
    { revision: "0", startDate: "2026-08-30", endDate: null },
  );
  expect(result.warnings).toEqual(["EXPENSE_BEFORE_ACTIVITY_START"]);
  expect(result.activity.startDate).toBe("2026-08-30");
});

it("并发创建首笔 Expense 与修改主币种时账单基准始终匹配活动", async () => {
  const activity = await createActivity();
  const request = {
    clientMutationId: `concurrent-${randomUUID()}`,
    title: "并发账单",
    category: "FOOD",
    originalCurrency: "CNY",
    originalAmountMinor: "1000",
    exchangeRate: "1",
    exchangeRateSource: "MANUAL" as const,
    exchangeRateAt: "2026-08-25T08:00:00.000Z",
    occurredAt: "2026-08-25T08:00:00.000Z",
    payments: [{ memberId: activity.ownerMemberId, amountMinor: "1000" }],
    split: { mode: "EQUAL" as const, members: [activity.ownerMemberId] },
  };

  const [expenseResult, updateResult] = await Promise.allSettled([
    new ExpenseService(harness.sql).create(ownerSession, activity.id, request),
    new ActivityDetailsService(harness.sql).update(ownerSession, activity.id, {
      revision: "0",
      baseCurrency: "JPY",
    }),
  ]);

  expect(expenseResult.status).toBe("fulfilled");
  if (updateResult.status === "rejected") {
    expect(updateResult.reason).toMatchObject({ code: "VERSION_CONFLICT" });
  }
  const [stored] = await harness.sql`
    select activity.base_currency as activity_currency,
           expense.base_currency as expense_currency
    from activities activity
    join expenses expense on expense.activity_id = activity.id
    where activity.id = ${activity.id}`;
  expect(stored?.expense_currency).toBe(stored?.activity_currency);
});
