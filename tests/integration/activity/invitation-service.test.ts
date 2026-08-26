import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";
import { InvitationService } from "@/server/services/invitation-service";

let harness: PostgresHarness;
let activityId: string;
const ownerSession = { user: { id: "owner-user" } };

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser("owner-user", "owner@example.com");
  await harness.seedCredentialUser("candidate-user", "candidate@example.com");
  activityId = (
    await new ActivityService(harness.sql).create({
      session: ownerSession,
      name: "名古屋",
      baseCurrency: "CNY",
      startDate: "2026-08-23",
      ownerDisplayName: "Owner",
    })
  ).id;
});

afterAll(async () => {
  await harness?.stop();
});

it("仅存储链接 Token 的 Hash，并可撤销注册链接 proof", async () => {
  const service = new InvitationService(harness.sql);
  const raw = await service.resetLink({ session: ownerSession, activityId });
  const [row] =
    await harness.sql`select token_hash from activity_invite_tokens where activity_id = ${activityId} and enabled = true`;

  expect(row?.token_hash).not.toContain(raw);
  await expect(service.verify(raw)).resolves.toBe(true);
  await service.disableLink({ session: ownerSession, activityId });
  await expect(service.verify(raw)).resolves.toBe(false);
});

it("允许活动管理者审批已验证链接提交的加入申请", async () => {
  const service = new InvitationService(harness.sql);
  const raw = await service.resetLink({ session: ownerSession, activityId });
  await harness.sql`update activities set invite_mode = 'REQUIRE_APPROVAL' where id = ${activityId}`;
  const pending = await service.join({
    session: { user: { id: "candidate-user" } },
    activityId,
    inviteProof: raw,
    displayName: "候选成员",
  });
  await service.decideJoinRequest({
    session: ownerSession,
    activityId,
    requestId: pending.requestId!,
    decision: "APPROVE",
    displayName: "候选成员",
  });

  const [member] =
    await harness.sql`select status from activity_members where activity_id = ${activityId} and user_id = 'candidate-user'`;
  expect(member?.status).toBe("ACTIVE");
});
