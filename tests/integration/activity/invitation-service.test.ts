import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActivityService } from "@/server/services/activity-service";
import { InvitationService } from "@/server/services/invitation-service";
import { startPostgres, type PostgresHarness } from "../../support/postgres";

let harness: PostgresHarness;

async function createFixture(
  inviteMode: "DIRECT_JOIN" | "REQUIRE_APPROVAL" = "DIRECT_JOIN",
) {
  const ownerUserId = `owner-${randomUUID()}`;
  await harness.seedCredentialUser(ownerUserId, `${ownerUserId}@local.invalid`);
  const activity = await new ActivityService(harness.sql).create({
    name: `邀请测试-${randomUUID()}`,
    baseCurrency: "CNY",
    startDate: "2026-08-26",
    ownerUserId,
    ownerDisplayName: "活动 Owner",
  });
  await harness.sql`
    update activities set invite_mode = ${inviteMode} where id = ${activity.id}
  `;

  return { ...activity, ownerUserId };
}

async function seedUser(): Promise<string> {
  const userId = `user-${randomUUID()}`;
  await harness.seedCredentialUser(userId, `${userId}@local.invalid`);
  return userId;
}

/**
 * 邀请服务依赖 PostgreSQL 的行锁、部分唯一索引与事务回滚；运行验证按项目约定留到最终
 * Testcontainers 验收。本套件先固定令牌不可逆保存、加入审批和稳定错误的服务契约。
 */
describe("InvitationService", () => {
  beforeAll(async () => {
    harness = await startPostgres();
  }, 60_000);

  afterAll(async () => {
    if (harness) await harness.stop();
  });

  it("重置仅保存哈希，保留唯一启用链接，并在停用后拒绝原始证明", async () => {
    const fixture = await createFixture();
    const service = new InvitationService(harness.sql);
    const firstProof = await service.resetLink(
      fixture.id,
      fixture.ownerMemberId,
    );
    const secondProof = await service.resetLink(
      fixture.id,
      fixture.ownerMemberId,
    );

    const tokens = await harness.sql<{ tokenHash: string; enabled: boolean }[]>`
      select token_hash as "tokenHash", enabled
      from activity_invite_tokens
      where activity_id = ${fixture.id}
      order by created_at, id
    `;
    const [activity] = await harness.sql<{ revision: string }[]>`
      select revision::text as revision from activities where id = ${fixture.id}
    `;
    const audits = await harness.sql<
      { eventType: string; metadata: unknown }[]
    >`
      select event_type as "eventType", metadata
      from activity_audit_logs
      where activity_id = ${fixture.id} and event_type = 'INVITE_LINK_RESET'
      order by created_at, id
    `;

    expect(firstProof).not.toBe(secondProof);
    expect(tokens).toHaveLength(2);
    expect(tokens.filter((token) => token.enabled)).toHaveLength(1);
    expect(tokens.every((token) => token.tokenHash !== firstProof)).toBe(true);
    expect(tokens.every((token) => token.tokenHash !== secondProof)).toBe(true);
    expect(await service.verify(firstProof)).toBe(false);
    expect(await service.verify(secondProof)).toBe(true);
    expect(activity.revision).toBe("2");
    expect(audits).toEqual([
      { eventType: "INVITE_LINK_RESET", metadata: {} },
      { eventType: "INVITE_LINK_RESET", metadata: {} },
    ]);

    await service.disableLink(fixture.id, fixture.ownerMemberId);
    expect(await service.verify(secondProof)).toBe(false);
    await service.disableLink(fixture.id, fixture.ownerMemberId);
    const [disabledActivity] = await harness.sql<{ revision: string }[]>`
      select revision::text as revision from activities where id = ${fixture.id}
    `;
    const disabledAudits = await harness.sql<{ count: string }[]>`
      select count(*)::text as count
      from activity_audit_logs
      where activity_id = ${fixture.id} and event_type = 'INVITE_LINK_DISABLED'
    `;
    expect(disabledActivity.revision).toBe("3");
    expect(disabledAudits).toEqual([{ count: "1" }]);
  });

  it("直接加入在同一事务创建 ACTIVE USER 成员、审计和 revision", async () => {
    const fixture = await createFixture("DIRECT_JOIN");
    const joiningUserId = await seedUser();
    const result = await new InvitationService(harness.sql).join(
      fixture.id,
      joiningUserId,
      "新成员",
    );

    const [member] = await harness.sql<
      { id: string; userId: string; status: string; memberType: string }[]
    >`
      select id, user_id as "userId", status, member_type as "memberType"
      from activity_members where id = ${result.memberId!}
    `;
    const [activity] = await harness.sql<{ revision: string }[]>`
      select revision::text as revision from activities where id = ${fixture.id}
    `;
    const [audit] = await harness.sql<
      { actorUserId: string; actorMemberId: string; eventType: string }[]
    >`
      select actor_user_id as "actorUserId", actor_member_id as "actorMemberId", event_type as "eventType"
      from activity_audit_logs where target_id = ${result.memberId!}
    `;

    expect(result.requestId).toBeUndefined();
    expect(member).toEqual({
      id: result.memberId,
      userId: joiningUserId,
      status: "ACTIVE",
      memberType: "USER",
    });
    expect(activity.revision).toBe("1");
    expect(audit).toEqual({
      actorUserId: joiningUserId,
      actorMemberId: result.memberId,
      eventType: "MEMBER_JOINED",
    });
  });

  it("审批模式只创建一个待处理申请，批准后创建成员、审计、通知和 revision", async () => {
    const fixture = await createFixture("REQUIRE_APPROVAL");
    const joiningUserId = await seedUser();
    const service = new InvitationService(harness.sql);
    const joined = await service.join(fixture.id, joiningUserId, "待审批成员");

    await service.decideJoinRequest(
      joined.requestId!,
      fixture.ownerMemberId,
      "APPROVE",
      "已批准成员",
    );

    const [request] = await harness.sql<
      {
        status: string;
        decidedByMemberId: string | null;
        decidedAt: Date | null;
      }[]
    >`
      select status, decided_by_member_id as "decidedByMemberId", decided_at as "decidedAt"
      from activity_join_requests where id = ${joined.requestId!}
    `;
    const [member] = await harness.sql<
      { userId: string; status: string; displayName: string }[]
    >`
      select user_id as "userId", status, display_name as "displayName"
      from activity_members where activity_id = ${fixture.id} and user_id = ${joiningUserId}
    `;
    const [activity] = await harness.sql<{ revision: string }[]>`
      select revision::text as revision from activities where id = ${fixture.id}
    `;
    const audits = await harness.sql<{ eventType: string }[]>`
      select event_type as "eventType" from activity_audit_logs
      where activity_id = ${fixture.id}
        and event_type in ('JOIN_REQUEST_CREATED', 'JOIN_REQUEST_APPROVED')
      order by created_at, id
    `;
    const [notification] = await harness.sql<
      {
        recipientUserId: string;
        type: string;
        targetType: string;
        targetId: string;
      }[]
    >`
      select recipient_user_id as "recipientUserId", type, target_type as "targetType", target_id as "targetId"
      from notifications where recipient_user_id = ${joiningUserId}
    `;

    expect(request).toMatchObject({
      status: "APPROVED",
      decidedByMemberId: fixture.ownerMemberId,
    });
    expect(request.decidedAt).toBeInstanceOf(Date);
    expect(member).toEqual({
      userId: joiningUserId,
      status: "ACTIVE",
      displayName: "已批准成员",
    });
    expect(activity.revision).toBe("2");
    expect(audits).toEqual([
      { eventType: "JOIN_REQUEST_CREATED" },
      { eventType: "JOIN_REQUEST_APPROVED" },
    ]);
    expect(notification).toEqual({
      recipientUserId: joiningUserId,
      type: "JOIN_REQUEST_APPROVED",
      targetType: "ACTIVITY",
      targetId: fixture.id,
    });
  });

  it("拒绝申请不创建成员，但写入决定、审计和通知", async () => {
    const fixture = await createFixture("REQUIRE_APPROVAL");
    const joiningUserId = await seedUser();
    const service = new InvitationService(harness.sql);
    const joined = await service.join(fixture.id, joiningUserId, "待拒绝成员");

    await service.decideJoinRequest(
      joined.requestId!,
      fixture.ownerMemberId,
      "REJECT",
      "无需写入成员的名称",
    );

    const [request] = await harness.sql<{ status: string }[]>`
      select status from activity_join_requests where id = ${joined.requestId!}
    `;
    const members = await harness.sql`
      select id from activity_members
      where activity_id = ${fixture.id} and user_id = ${joiningUserId}
    `;
    const [notification] = await harness.sql<{ type: string }[]>`
      select type from notifications where recipient_user_id = ${joiningUserId}
    `;

    expect(request).toEqual({ status: "REJECTED" });
    expect(members).toHaveLength(0);
    expect(notification).toEqual({ type: "JOIN_REQUEST_REJECTED" });
  });

  it("对重复申请、已有成员、非管理员、LEFT 管理者和非 ACTIVE 活动返回稳定错误", async () => {
    const fixture = await createFixture("REQUIRE_APPROVAL");
    const joiningUserId = await seedUser();
    const memberUserId = await seedUser();
    const leftAdminUserId = await seedUser();
    const service = new InvitationService(harness.sql);
    const pending = await service.join(fixture.id, joiningUserId, "重复申请者");
    const directFixture = await createFixture("DIRECT_JOIN");
    await service.join(directFixture.id, memberUserId, "已有成员");

    const regularMemberId = randomUUID();
    await harness.sql`
      insert into activity_members (
        id, activity_id, user_id, display_name, member_type, role, status
      ) values (
        ${regularMemberId}, ${fixture.id}, ${memberUserId}, '普通成员', 'USER', 'MEMBER', 'ACTIVE'
      )
    `;

    await expect(
      service.join(fixture.id, joiningUserId, "重复申请者"),
    ).rejects.toMatchObject({ code: "JOIN_REQUEST_PENDING", status: 409 });
    await expect(
      service.join(directFixture.id, memberUserId, "已有成员"),
    ).rejects.toMatchObject({ code: "ALREADY_ACTIVITY_MEMBER", status: 409 });
    await expect(
      service.decideJoinRequest(
        pending.requestId!,
        regularMemberId,
        "REJECT",
        "普通成员不能审批",
      ),
    ).rejects.toMatchObject({ code: "ROLE_FORBIDDEN", status: 403 });
    await expect(
      service.decideJoinRequest(
        pending.requestId!,
        fixture.ownerMemberId,
        "APPROVE",
        "已批准成员",
      ),
    ).resolves.toBeUndefined();

    await harness.sql`
      insert into activity_members (
        id, activity_id, user_id, display_name, member_type, role, status, left_at
      ) values (
        ${randomUUID()}, ${fixture.id}, ${leftAdminUserId}, '已离开管理员', 'USER', 'ADMIN', 'LEFT', now()
      )
    `;
    const anotherUserId = await seedUser();
    const nextPending = await service.join(
      fixture.id,
      anotherUserId,
      "第二申请者",
    );
    const [leftAdmin] = await harness.sql<{ id: string }[]>`
      select id from activity_members
      where activity_id = ${fixture.id} and user_id = ${leftAdminUserId}
    `;
    await expect(
      service.decideJoinRequest(
        nextPending.requestId!,
        leftAdmin.id,
        "REJECT",
        "第二申请者",
      ),
    ).rejects.toMatchObject({ code: "ROLE_FORBIDDEN", status: 403 });

    await harness.sql`
      update activities set status = 'ENDED' where id = ${fixture.id}
    `;
    const endedUserId = await seedUser();
    await expect(
      service.join(fixture.id, endedUserId, "已结束活动申请者"),
    ).rejects.toMatchObject({ code: "ACTIVITY_READ_ONLY", status: 409 });

    const [pendingRequest] = await harness.sql<{ status: string }[]>`
      select status from activity_join_requests where id = ${nextPending.requestId!}
    `;
    expect(pendingRequest).toEqual({ status: "PENDING" });
  });
});
