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
let secondLeftMemberId: string;
const ownerSession = { user: { id: "settlement-owner" } };
const leftSession = { user: { id: "settlement-left" } };

function request(
  payerMemberId: string,
  receiverMemberId: string,
  confirmOverSettlement = false,
) {
  return {
    payerMemberId,
    receiverMemberId,
    amountMinor: "100",
    occurredAt: "2026-08-23T08:00:00.000Z",
    confirmOverSettlement,
  };
}

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser(
    ownerSession.user.id,
    "settlement-owner@example.com",
  );
  await harness.seedCredentialUser(
    leftSession.user.id,
    "settlement-left@example.com",
  );
  await harness.seedCredentialUser(
    "settlement-second-left",
    "second-left@example.com",
  );
  const activity = await new ActivityService(harness.sql).create({
    session: ownerSession,
    name: "结算权限活动",
    baseCurrency: "CNY",
    startDate: "2026-08-23",
    ownerDisplayName: "Owner",
  });
  activityId = activity.id;
  ownerMemberId = activity.ownerMemberId;
  leftMemberId = randomUUID();
  secondLeftMemberId = randomUUID();
  await harness.sql`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at, left_at)
    values (${leftMemberId}, ${activityId}, ${leftSession.user.id}, 'Left', 'USER', 'MEMBER', 'LEFT', now(), now()),
           (${secondLeftMemberId}, ${activityId}, 'settlement-second-left', 'Second left', 'USER', 'MEMBER', 'LEFT', now(), now())`;
});

afterAll(async () => {
  await harness?.stop();
});

it("LEFT 只能以自己为付款人，收款人可以是 LEFT 账务成员", async () => {
  const service = new SettlementService(harness.sql);
  await expect(
    service.create(
      leftSession,
      activityId,
      request(ownerMemberId, secondLeftMemberId),
    ),
  ).rejects.toMatchObject({
    status: 403,
    code: "SETTLEMENT_PAYER_MUST_BE_SELF",
  });
  await expect(
    service.create(
      leftSession,
      activityId,
      request(leftMemberId, secondLeftMemberId, true),
    ),
  ).resolves.toMatchObject({
    settlement: {
      payer_member_id: leftMemberId,
      receiver_member_id: secondLeftMemberId,
    },
  });
});

it("活动归档状态优先于 LEFT 权限", async () => {
  await harness.sql`update activities set status = 'ARCHIVED' where id = ${activityId}`;
  await expect(
    new SettlementService(harness.sql).create(
      leftSession,
      activityId,
      request(leftMemberId, secondLeftMemberId),
    ),
  ).rejects.toMatchObject({ status: 409, code: "ACTIVITY_READ_ONLY" });
});
