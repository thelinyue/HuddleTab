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
  await harness.seedCredentialUser(
    "settlement-schema-user",
    "schema@example.com",
  );
  const activity = await new ActivityService(harness.sql).create({
    session: { user: { id: "settlement-schema-user" } },
    name: "结算约束活动",
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

it("Settlement 拒绝非正金额和相同付款收款人", async () => {
  await expect(
    harness.sql`insert into settlements (id, activity_id, payer_member_id, receiver_member_id, amount_minor, currency, occurred_at, created_by_member_id, version)
      values (${randomUUID()}, ${activityId}, ${memberId}, ${memberId}, 0, 'CNY', now(), ${memberId}, 1)`,
  ).rejects.toMatchObject({ code: "23514" });
});
