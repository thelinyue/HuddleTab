import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";

let harness: PostgresHarness;
let activityId: string;
let memberId: string;

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser("expense-user", "expense@example.com");
  const activity = await new ActivityService(harness.sql).create({
    session: { user: { id: "expense-user" } },
    name: "神户",
    baseCurrency: "CNY",
    startDate: "2026-08-23",
    ownerDisplayName: "Owner",
  });
  activityId = activity.id;
  memberId = activity.ownerMemberId;
});

afterAll(async () => {
  await harness?.stop();
});

it("同一用户重试相同 client_mutation_id 只能保留一笔消费", async () => {
  const row = {
    id: randomUUID(),
    activityId,
    title: "晚餐",
    category: "FOOD",
    originalCurrency: "CNY",
    originalAmountMinor: "1000",
    baseCurrency: "CNY",
    baseAmountMinor: "1000",
    exchangeRate: "1",
    exchangeRateSource: "IDENTITY",
    exchangeRateAt: new Date().toISOString(),
    splitMode: "EQUAL",
    occurredAt: new Date().toISOString(),
    createdByMemberId: memberId,
    createdByUserId: "expense-user",
    clientMutationId: "01JEXPENSEMUTATION00000001",
    version: 1,
  };
  await harness.sql`insert into expenses (id, activity_id, title, category, original_currency, original_amount_minor, base_currency, base_amount_minor, exchange_rate, exchange_rate_source, exchange_rate_at, split_mode, occurred_at, created_by_member_id, created_by_user_id, client_mutation_id, version)
    values (${row.id}, ${row.activityId}, ${row.title}, ${row.category}, ${row.originalCurrency}, ${row.originalAmountMinor}, ${row.baseCurrency}, ${row.baseAmountMinor}, ${row.exchangeRate}, ${row.exchangeRateSource}, ${row.exchangeRateAt}, ${row.splitMode}, ${row.occurredAt}, ${row.createdByMemberId}, ${row.createdByUserId}, ${row.clientMutationId}, ${row.version})`;
  await expect(
    harness.sql`insert into expenses (id, activity_id, title, category, original_currency, original_amount_minor, base_currency, base_amount_minor, exchange_rate, exchange_rate_source, exchange_rate_at, split_mode, occurred_at, created_by_member_id, created_by_user_id, client_mutation_id, version)
      values (${randomUUID()}, ${row.activityId}, ${row.title}, ${row.category}, ${row.originalCurrency}, ${row.originalAmountMinor}, ${row.baseCurrency}, ${row.baseAmountMinor}, ${row.exchangeRate}, ${row.exchangeRateSource}, ${row.exchangeRateAt}, ${row.splitMode}, ${row.occurredAt}, ${row.createdByMemberId}, ${row.createdByUserId}, ${row.clientMutationId}, ${row.version})`,
  ).rejects.toMatchObject({ code: "23505" });
});
