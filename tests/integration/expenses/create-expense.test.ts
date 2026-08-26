import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";
import { ExpenseService } from "@/server/services/expense-service";

let harness: PostgresHarness;
let activityId: string;
const session = { user: { id: "expense-owner" } };

const request = {
  clientMutationId: "01JEXPENSERETRY0000000001",
  title: "晚餐",
  category: "FOOD",
  originalCurrency: "CNY",
  originalAmountMinor: "1000",
  exchangeRate: "1",
  exchangeRateSource: "IDENTITY" as const,
  exchangeRateAt: "2026-08-23T08:00:00.000Z",
  occurredAt: "2026-08-23T08:00:00.000Z",
  payments: [{ memberId: "", amountMinor: "1000" }],
  split: { mode: "EQUAL" as const, members: [""] },
};

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser("expense-owner", "owner@example.com");
  const activity = await new ActivityService(harness.sql).create({
    session,
    name: "大阪",
    baseCurrency: "CNY",
    startDate: "2026-08-23",
    ownerDisplayName: "Owner",
  });
  activityId = activity.id;
  request.payments[0]!.memberId = activity.ownerMemberId;
  request.split.members[0] = activity.ownerMemberId;
});

afterAll(async () => {
  await harness?.stop();
});

it("重复创建返回原资源且不重复 Audit 与 Revision", async () => {
  const service = new ExpenseService(harness.sql);
  const first = await service.create(session, activityId, request);
  const replay = await service.create(session, activityId, request);

  expect(replay.expense.id).toBe(first.expense.id);
  expect(replay.idempotentReplay).toBe(true);
  const [counts] =
    await harness.sql`select (select count(*) from expenses)::text as expenses, (select count(*) from activity_audit_logs where event_type = 'EXPENSE_CREATED')::text as audits`;
  const [activity] =
    await harness.sql`select revision from activities where id = ${activityId}`;
  expect(counts).toEqual({ expenses: "1", audits: "1" });
  expect(activity?.revision).toBe("1");
});
