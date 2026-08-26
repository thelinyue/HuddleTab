import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ActivityService } from "@/server/services/activity-service";
import {
  MemberService,
  type AccountingIdentityUsageReader,
} from "@/server/services/member-service";
import { startPostgres, type PostgresHarness } from "../../support/postgres";

let harness: PostgresHarness;

function createUsageReader(hasFacts: boolean): AccountingIdentityUsageReader {
  return { hasFacts: vi.fn().mockResolvedValue(hasFacts) };
}

async function createActivity(ownerUserId: string) {
  await harness.seedCredentialUser(ownerUserId, `${ownerUserId}@local.invalid`);

  const service = new ActivityService(harness.sql);
  return service.create({
    name: "周末聚餐",
    baseCurrency: "CNY",
    startDate: "2026-08-26",
    ownerUserId,
    ownerDisplayName: "发起人",
  });
}

/**
 * 成员服务依赖真实 PostgreSQL 的 deferred 外键与行锁语义；本套件保护成员 ID 作为记账身份
 * 不因访客绑定而变化，并验证事实存在时只能把成员标记为离开，不能删除历史关联主体。
 */
describe("activity member services", () => {
  beforeAll(async () => {
    harness = await startPostgres();
  }, 60_000);

  afterAll(async () => {
    if (harness) {
      await harness.stop();
    }
  });

  it("creates the activity, active owner, and creation audit in one transaction", async () => {
    const ownerUserId = `owner-${randomUUID()}`;
    const result = await createActivity(ownerUserId);

    const [activity] = await harness.sql<
      {
        id: string;
        ownerMemberId: string;
        revision: string;
      }[]
    >`
      select
        id,
        owner_member_id as "ownerMemberId",
        revision::text as revision
      from activities
      where id = ${result.id}
    `;
    const [owner] = await harness.sql<
      {
        id: string;
        userId: string;
        role: string;
        status: string;
        memberType: string;
      }[]
    >`
      select
        id,
        user_id as "userId",
        role,
        status,
        member_type as "memberType"
      from activity_members
      where id = ${result.ownerMemberId}
    `;
    const [audit] = await harness.sql<
      {
        activityId: string;
        actorUserId: string;
        actorMemberId: string;
        eventType: string;
        targetType: string;
        targetId: string;
        metadata: Record<string, unknown>;
      }[]
    >`
      select
        activity_id as "activityId",
        actor_user_id as "actorUserId",
        actor_member_id as "actorMemberId",
        event_type as "eventType",
        target_type as "targetType",
        target_id as "targetId",
        metadata
      from activity_audit_logs
      where activity_id = ${result.id}
    `;

    expect(activity).toMatchObject({
      id: result.id,
      ownerMemberId: result.ownerMemberId,
      revision: "0",
    });
    expect(owner).toMatchObject({
      id: result.ownerMemberId,
      userId: ownerUserId,
      role: "OWNER",
      status: "ACTIVE",
      memberType: "USER",
    });
    expect(audit).toEqual({
      activityId: result.id,
      actorUserId: ownerUserId,
      actorMemberId: result.ownerMemberId,
      eventType: "ACTIVITY_CREATED",
      targetType: "ACTIVITY",
      targetId: result.id,
      metadata: {},
    });
  });

  it("binds a guest to a user without changing the member ID and records the mutation", async () => {
    const ownerUserId = `owner-${randomUUID()}`;
    const guestUserId = `guest-user-${randomUUID()}`;
    const { id: activityId, ownerMemberId } = await createActivity(ownerUserId);
    await harness.seedCredentialUser(
      guestUserId,
      `${guestUserId}@local.invalid`,
    );
    const memberService = new MemberService(
      harness.sql,
      createUsageReader(false),
    );
    const { id: guestMemberId } = await memberService.addGuest(
      activityId,
      "访客",
      { userId: ownerUserId, memberId: ownerMemberId },
    );

    await memberService.bindGuest(guestMemberId, guestUserId, {
      userId: ownerUserId,
      memberId: ownerMemberId,
    });

    const [member] = await harness.sql<
      {
        id: string;
        userId: string;
        memberType: string;
      }[]
    >`
      select id, user_id as "userId", member_type as "memberType"
      from activity_members
      where id = ${guestMemberId}
    `;
    const [activity] = await harness.sql<{ revision: string }[]>`
      select revision::text as revision from activities where id = ${activityId}
    `;
    const audits = await harness.sql<
      {
        eventType: string;
        targetType: string;
        targetId: string;
      }[]
    >`
      select
        event_type as "eventType",
        target_type as "targetType",
        target_id as "targetId"
      from activity_audit_logs
      where activity_id = ${activityId}
      order by created_at, id
    `;

    expect(member).toEqual({
      id: guestMemberId,
      userId: guestUserId,
      memberType: "USER",
    });
    expect(activity.revision).toBe("2");
    expect(audits).toEqual(
      expect.arrayContaining([
        {
          eventType: "MEMBER_GUEST_ADDED",
          targetType: "ACTIVITY_MEMBER",
          targetId: guestMemberId,
        },
        {
          eventType: "MEMBER_GUEST_BOUND",
          targetType: "ACTIVITY_MEMBER",
          targetId: guestMemberId,
        },
      ]),
    );
  });

  it("rejects leave and remove for the owner with OWNER_TRANSFER_REQUIRED", async () => {
    const ownerUserId = `owner-${randomUUID()}`;
    const { ownerMemberId } = await createActivity(ownerUserId);
    const memberService = new MemberService(
      harness.sql,
      createUsageReader(false),
    );

    await expect(memberService.leave(ownerMemberId)).rejects.toMatchObject({
      code: "OWNER_TRANSFER_REQUIRED",
      status: 409,
    });
    await expect(memberService.remove(ownerMemberId)).rejects.toMatchObject({
      code: "OWNER_TRANSFER_REQUIRED",
      status: 409,
    });
  });

  it("deletes a member without facts but preserves a member with facts as LEFT", async () => {
    const ownerUserId = `owner-${randomUUID()}`;
    const { id: activityId, ownerMemberId } = await createActivity(ownerUserId);
    const memberService = new MemberService(
      harness.sql,
      createUsageReader(false),
    );
    const { id: removableMemberId } = await memberService.addGuest(
      activityId,
      "可删除访客",
      { userId: ownerUserId, memberId: ownerMemberId },
    );

    await memberService.remove(removableMemberId);

    const deleted = await harness.sql`
      select id from activity_members where id = ${removableMemberId}
    `;
    expect(deleted).toHaveLength(0);

    const factsUsage = createUsageReader(true);
    const preservingService = new MemberService(harness.sql, factsUsage);
    const { id: historicalMemberId } = await preservingService.addGuest(
      activityId,
      "有历史事实的访客",
      { userId: ownerUserId, memberId: ownerMemberId },
    );

    await preservingService.remove(historicalMemberId);

    const [preserved] = await harness.sql<
      {
        id: string;
        status: string;
        leftAt: Date | null;
      }[]
    >`
      select id, status, left_at as "leftAt"
      from activity_members
      where id = ${historicalMemberId}
    `;
    const [activity] = await harness.sql<{ revision: string }[]>`
      select revision::text as revision from activities where id = ${activityId}
    `;
    const audits = await harness.sql<
      {
        eventType: string;
        targetId: string;
        metadata: Record<string, unknown>;
      }[]
    >`
      select
        event_type as "eventType",
        target_id as "targetId",
        metadata
      from activity_audit_logs
      where activity_id = ${activityId}
        and event_type in ('MEMBER_REMOVED', 'MEMBER_REMOVED_LEFT')
      order by event_type
    `;

    expect(factsUsage.hasFacts).toHaveBeenCalledWith(historicalMemberId);
    expect(preserved).toMatchObject({
      id: historicalMemberId,
      status: "LEFT",
    });
    expect(preserved.leftAt).toBeInstanceOf(Date);
    expect(activity.revision).toBe("4");
    expect(audits).toEqual([
      {
        eventType: "MEMBER_REMOVED",
        targetId: removableMemberId,
        metadata: {},
      },
      {
        eventType: "MEMBER_REMOVED_LEFT",
        targetId: historicalMemberId,
        metadata: {},
      },
    ]);
  });
});
