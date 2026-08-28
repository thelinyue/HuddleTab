import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

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
});

beforeEach(async () => {
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

it("重置链接会立即废弃旧 Token", async () => {
  const service = new InvitationService(harness.sql);
  const oldRaw = await service.resetLink({ session: ownerSession, activityId });
  const currentRaw = await service.resetLink({
    session: ownerSession,
    activityId,
  });

  await expect(service.verify(oldRaw)).resolves.toBe(false);
  await expect(service.verify(currentRaw)).resolves.toBe(true);
});

it("未关闭或重置的旧 Token 不按创建时间自动过期", async () => {
  const service = new InvitationService(harness.sql);
  const raw = await service.resetLink({ session: ownerSession, activityId });
  await harness.sql`update activity_invite_tokens set created_at = '2020-01-01T00:00:00.000Z' where activity_id = ${activityId} and enabled = true`;

  await expect(service.verify(raw)).resolves.toBe(true);
});

it.each(["ENDED", "ARCHIVED", "DELETED"] as const)(
  "%s 活动不能继续使用邀请 Token",
  async (lifecycle) => {
    const service = new InvitationService(harness.sql);
    const raw = await service.resetLink({ session: ownerSession, activityId });
    if (lifecycle === "DELETED") {
      await harness.sql`update activities set deleted_at = now() where id = ${activityId}`;
    } else {
      await harness.sql`update activities set status = ${lifecycle} where id = ${activityId}`;
    }

    await expect(service.verify(raw)).resolves.toBe(false);
    await expect(
      service.join({
        session: { user: { id: "candidate-user" } },
        inviteProof: raw,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
  },
);

it("直接加入写入账务身份、审计、版本和通知，重复打开链接返回已有成员", async () => {
  const service = new InvitationService(harness.sql);
  const raw = await service.resetLink({ session: ownerSession, activityId });
  const [before] =
    await harness.sql`select revision from activities where id = ${activityId}`;

  const joined = await service.join({
    session: { user: { id: "candidate-user" } },
    inviteProof: raw,
  });

  expect(joined).toMatchObject({ status: "JOINED", activityId });
  const members =
    await harness.sql`select id from activity_members where activity_id = ${activityId} and user_id = 'candidate-user'`;
  expect(members).toHaveLength(1);
  const [after] =
    await harness.sql`select revision from activities where id = ${activityId}`;
  expect(BigInt(after!.revision)).toBe(BigInt(before!.revision) + 1n);
  const audit =
    await harness.sql`select event_type from activity_audit_logs where activity_id = ${activityId} and event_type = 'MEMBER_JOINED'`;
  expect(audit).toHaveLength(1);
  const notification =
    await harness.sql`select type from notifications where recipient_user_id = 'owner-user' and target_id = ${activityId} and type = 'MEMBER_JOINED'`;
  expect(notification).toHaveLength(1);

  const repeated = await service.join({
    session: { user: { id: "candidate-user" } },
    inviteProof: raw,
  });
  expect(repeated).toEqual({
    status: "ALREADY_MEMBER",
    activityId,
    memberId: members[0]!.id,
  });
  expect(
    await harness.sql`select id from activity_members where activity_id = ${activityId} and user_id = 'candidate-user'`,
  ).toHaveLength(1);
});

it("已离开成员重复打开有效邀请时返回原账务身份且不自动恢复", async () => {
  const service = new InvitationService(harness.sql);
  const raw = await service.resetLink({ session: ownerSession, activityId });
  const joined = await service.join({
    session: { user: { id: "candidate-user" } },
    inviteProof: raw,
  });
  if (joined.status !== "JOINED") {
    throw new Error("预期候选用户首次直接加入活动。");
  }
  await harness.sql`update activity_members set status = 'LEFT', left_at = now() where id = ${joined.memberId}`;

  await expect(
    service.join({
      session: { user: { id: "candidate-user" } },
      inviteProof: raw,
    }),
  ).resolves.toEqual({
    status: "ALREADY_MEMBER",
    activityId,
    memberId: joined.memberId,
  });
  expect(
    await harness.sql`select id, status from activity_members where activity_id = ${activityId} and user_id = 'candidate-user'`,
  ).toEqual([{ id: joined.memberId, status: "LEFT" }]);
});

it("审批模式重复打开链接只保留一条待审批申请", async () => {
  const service = new InvitationService(harness.sql);
  const raw = await service.resetLink({ session: ownerSession, activityId });
  await harness.sql`update activities set invite_mode = 'REQUIRE_APPROVAL' where id = ${activityId}`;
  const pending = await service.join({
    session: { user: { id: "candidate-user" } },
    inviteProof: raw,
  });
  expect(pending).toMatchObject({ status: "PENDING_APPROVAL", activityId });
  if (pending.status !== "PENDING_APPROVAL") {
    throw new Error("预期进入等待审批状态。");
  }

  const repeated = await service.join({
    session: { user: { id: "candidate-user" } },
    inviteProof: raw,
  });
  expect(repeated).toEqual(pending);
  expect(
    await harness.sql`select id from activity_join_requests where activity_id = ${activityId} and user_id = 'candidate-user' and status = 'PENDING'`,
  ).toHaveLength(1);

  await service.decideJoinRequest({
    session: ownerSession,
    activityId,
    requestId: pending.requestId,
    decision: "APPROVE",
  });

  const [member] =
    await harness.sql`select status from activity_members where activity_id = ${activityId} and user_id = 'candidate-user'`;
  expect(member?.status).toBe("ACTIVE");
});
