import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";
import { ExpenseService } from "@/server/services/expense-service";

let harness: PostgresHarness;

const ownerSession = { user: { id: "expense-update-owner" } };

function createRequest(memberId: string, clientMutationId = randomUUID()) {
  return {
    clientMutationId,
    title: "晚餐",
    category: "FOOD",
    originalCurrency: "CNY",
    originalAmountMinor: "1000",
    exchangeRate: "1",
    exchangeRateSource: "IDENTITY" as const,
    exchangeRateAt: "2026-08-23T08:00:00.000Z",
    occurredAt: "2026-08-23T08:00:00.000Z",
    payments: [{ memberId, amountMinor: "1000" }],
    split: { mode: "EQUAL" as const, members: [memberId] },
  };
}

async function createActivity(userId: string, name: string) {
  const activity = await new ActivityService(harness.sql).create({
    session: { user: { id: userId } },
    name,
    baseCurrency: "CNY",
    startDate: "2026-08-23",
    ownerDisplayName: userId,
  });
  return activity;
}

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser(ownerSession.user.id, "owner@example.com");
});

afterAll(async () => {
  await harness?.stop();
});

it("旧版本修改返回 VERSION_CONFLICT 且不覆盖新值", async () => {
  const activity = await createActivity(ownerSession.user.id, "版本锁活动");
  const service = new ExpenseService(harness.sql);
  const created = await service.create(
    ownerSession,
    activity.id,
    createRequest(activity.ownerMemberId),
  );

  await service.update(ownerSession, activity.id, created.expense.id, {
    ...createRequest(activity.ownerMemberId),
    title: "新标题",
    version: 1,
  });
  await expect(
    service.update(ownerSession, activity.id, created.expense.id, {
      ...createRequest(activity.ownerMemberId),
      title: "旧表单",
      version: 1,
    }),
  ).rejects.toMatchObject({
    status: 409,
    code: "VERSION_CONFLICT",
    message: "这笔消费已被其他人修改，请刷新后重试",
  });

  const [persisted] =
    await harness.sql`select title from expenses where id = ${created.expense.id}`;
  expect(persisted?.title).toBe("新标题");
});

it("LEFT 成员即使是创建者也不能删除历史消费", async () => {
  const actorId = "expense-left-creator";
  await harness.seedCredentialUser(actorId, "left@example.com");
  const activity = await createActivity(ownerSession.user.id, "退出成员活动");
  const actorMemberId = randomUUID();
  await harness.sql`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at)
    values (${actorMemberId}, ${activity.id}, ${actorId}, '退出成员', 'USER', 'MEMBER', 'ACTIVE', now())`;
  const service = new ExpenseService(harness.sql);
  const created = await service.create(
    { user: { id: actorId } },
    activity.id,
    createRequest(actorMemberId),
  );
  await harness.sql`update activity_members set status = 'LEFT', left_at = now() where id = ${actorMemberId}`;

  await expect(
    service.update({ user: { id: actorId } }, activity.id, created.expense.id, {
      ...createRequest(actorMemberId),
      version: 1,
    }),
  ).rejects.toMatchObject({
    status: 403,
    code: "EXPENSE_READ_ONLY_FOR_LEFT",
  });
  await expect(
    service.remove(
      { user: { id: actorId } },
      activity.id,
      created.expense.id,
      1,
    ),
  ).rejects.toMatchObject({
    status: 403,
    code: "EXPENSE_READ_ONLY_FOR_LEFT",
  });
});

it("更新时拒绝引用其他活动的成员", async () => {
  const activity = await createActivity(ownerSession.user.id, "成员校验活动");
  const other = await createActivity(ownerSession.user.id, "其他活动");
  const service = new ExpenseService(harness.sql);
  const created = await service.create(
    ownerSession,
    activity.id,
    createRequest(activity.ownerMemberId),
  );

  await expect(
    service.update(ownerSession, activity.id, created.expense.id, {
      ...createRequest(other.ownerMemberId),
      version: 1,
    }),
  ).rejects.toMatchObject({ status: 422, code: "INVALID_EXPENSE_MEMBER" });

  const [persisted] =
    await harness.sql`select version from expenses where id = ${created.expense.id}`;
  expect(persisted?.version).toBe("1");
});
