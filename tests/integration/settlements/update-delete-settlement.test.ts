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
let ownerMemberId: string;
let leftMemberId: string;
let settlementId: string;
const ownerSession = { user: { id: "settlement-update-owner" } };
const leftSession = { user: { id: "settlement-update-left" } };

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser(
    ownerSession.user.id,
    "settlement-update-owner@example.com",
  );
  await harness.seedCredentialUser(
    leftSession.user.id,
    "settlement-update-left@example.com",
  );
  const activity = await new ActivityService(harness.sql).create({
    session: ownerSession,
    name: "结算版本活动",
    baseCurrency: "CNY",
    startDate: "2026-08-23",
    ownerDisplayName: "Owner",
  });
  activityId = activity.id;
  ownerMemberId = activity.ownerMemberId;
  leftMemberId = randomUUID();
  settlementId = randomUUID();
  await harness.sql`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at, left_at)
    values (${leftMemberId}, ${activityId}, ${leftSession.user.id}, 'Left', 'USER', 'MEMBER', 'LEFT', now(), now())`;
  await harness.sql`insert into settlements (id, activity_id, payer_member_id, receiver_member_id, amount_minor, currency, occurred_at, created_by_member_id, version)
    values (${settlementId}, ${activityId}, ${ownerMemberId}, ${leftMemberId}, 100, 'CNY', now(), ${ownerMemberId}, 1)`;
});

afterAll(async () => {
  await harness?.stop();
});

it("LEFT 成员不能修改其他成员创建的 Settlement", async () => {
  await expect(
    new SettlementService(harness.sql).update(
      leftSession,
      activityId,
      settlementId,
      {
        payerMemberId: leftMemberId,
        receiverMemberId: ownerMemberId,
        amountMinor: "100",
        occurredAt: "2026-08-23T08:00:00.000Z",
        confirmOverSettlement: true,
        version: 1,
      },
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it("旧版本删除返回 VERSION_CONFLICT", async () => {
  await harness.sql`update settlements set version = 2 where id = ${settlementId}`;
  await expect(
    new SettlementService(harness.sql).remove(
      ownerSession,
      activityId,
      settlementId,
      1,
    ),
  ).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
});
