import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActivityService } from "@/server/services/activity-service";
import { MemberService } from "@/server/services/member-service";
import { OwnershipService } from "@/server/services/ownership-service";
import { startPostgres, type PostgresHarness } from "../../support/postgres";

let harness: PostgresHarness;

async function createOwnershipFixture(options?: {
  newOwnerStatus?: "ACTIVE" | "LEFT";
}) {
  const ownerUserId = `owner-${randomUUID()}`;
  const nextOwnerUserId = `next-owner-${randomUUID()}`;
  await harness.seedCredentialUser(ownerUserId, `${ownerUserId}@example.com`);
  await harness.seedCredentialUser(
    nextOwnerUserId,
    `${nextOwnerUserId}@example.com`,
  );

  const activity = await new ActivityService(harness.sql).create({
    name: `所有权转让测试-${randomUUID()}`,
    baseCurrency: "CNY",
    startDate: "2026-08-26",
    ownerUserId,
    ownerDisplayName: "原 Owner",
  });
  const memberService = new MemberService(harness.sql, {
    async hasFacts() {
      return false;
    },
  });
  const nextOwner = await memberService.addGuest(activity.id, "新 Owner", {
    userId: ownerUserId,
    memberId: activity.ownerMemberId,
  });
  await memberService.bindGuest(nextOwner.id, nextOwnerUserId, {
    userId: ownerUserId,
    memberId: activity.ownerMemberId,
  });

  if (options?.newOwnerStatus === "LEFT") {
    await memberService.leave(nextOwner.id, {
      userId: nextOwnerUserId,
      memberId: nextOwner.id,
    });
  }

  await harness.sql`
    update activities set revision = 0 where id = ${activity.id}
  `;

  return {
    activityId: activity.id,
    ownerMemberId: activity.ownerMemberId,
    ownerUserId,
    nextOwnerMemberId: nextOwner.id,
    nextOwnerUserId,
  };
}

beforeAll(async () => {
  harness = await startPostgres();
});

afterAll(async () => {
  await harness.stop();
});

describe("OwnershipService.transferOwnership", () => {
  it("在同一事务中转让角色、Owner 指针、审计、通知和 revision", async () => {
    const fixture = await createOwnershipFixture();

    await new OwnershipService(harness.sql).transferOwnership(
      fixture.activityId,
      fixture.ownerMemberId,
      fixture.nextOwnerMemberId,
    );

    const members = await harness.sql<
      { id: string; role: string; status: string }[]
    >`
      select id, role, status
      from activity_members
      where id in (${fixture.ownerMemberId}, ${fixture.nextOwnerMemberId})
      order by case when id = ${fixture.ownerMemberId} then 0 else 1 end
    `;
    const [activity] = await harness.sql<
      { ownerMemberId: string; revision: string }[]
    >`
      select owner_member_id as "ownerMemberId", revision::text as revision
      from activities
      where id = ${fixture.activityId}
    `;
    const [audit] = await harness.sql<
      {
        actorUserId: string | null;
        actorMemberId: string | null;
        eventType: string;
        targetType: string;
        targetId: string;
        metadata: Record<string, unknown>;
      }[]
    >`
      select
        actor_user_id as "actorUserId",
        actor_member_id as "actorMemberId",
        event_type as "eventType",
        target_type as "targetType",
        target_id as "targetId",
        metadata
      from activity_audit_logs
      where activity_id = ${fixture.activityId}
        and event_type = 'OWNER_TRANSFERRED'
    `;
    const [notification] = await harness.sql<
      {
        recipientUserId: string;
        type: string;
        targetType: string;
        targetId: string;
        payload: Record<string, unknown>;
      }[]
    >`
      select
        recipient_user_id as "recipientUserId",
        type,
        target_type as "targetType",
        target_id as "targetId",
        payload
      from notifications
      where recipient_user_id = ${fixture.nextOwnerUserId}
        and type = 'OWNER_TRANSFERRED'
    `;

    expect(members).toEqual([
      { id: fixture.ownerMemberId, role: "ADMIN", status: "ACTIVE" },
      { id: fixture.nextOwnerMemberId, role: "OWNER", status: "ACTIVE" },
    ]);
    expect(activity).toEqual({
      ownerMemberId: fixture.nextOwnerMemberId,
      revision: "1",
    });
    expect(audit).toEqual({
      actorUserId: fixture.ownerUserId,
      actorMemberId: fixture.ownerMemberId,
      eventType: "OWNER_TRANSFERRED",
      targetType: "ACTIVITY",
      targetId: fixture.activityId,
      metadata: {
        fromMemberId: fixture.ownerMemberId,
        toMemberId: fixture.nextOwnerMemberId,
      },
    });
    expect(notification).toEqual({
      recipientUserId: fixture.nextOwnerUserId,
      type: "OWNER_TRANSFERRED",
      targetType: "ACTIVITY",
      targetId: fixture.activityId,
      payload: {
        fromMemberId: fixture.ownerMemberId,
        activityId: fixture.activityId,
      },
    });
  });

  it("拒绝将所有权转给 LEFT 成员且不改变任何活动事实", async () => {
    const fixture = await createOwnershipFixture({ newOwnerStatus: "LEFT" });

    await expect(
      new OwnershipService(harness.sql).transferOwnership(
        fixture.activityId,
        fixture.ownerMemberId,
        fixture.nextOwnerMemberId,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_NEW_OWNER",
      status: 422,
    });

    const members = await harness.sql<{ id: string; role: string }[]>`
      select id, role
      from activity_members
      where id in (${fixture.ownerMemberId}, ${fixture.nextOwnerMemberId})
      order by case when id = ${fixture.ownerMemberId} then 0 else 1 end
    `;
    const [activity] = await harness.sql<
      { ownerMemberId: string; revision: string }[]
    >`
      select owner_member_id as "ownerMemberId", revision::text as revision
      from activities
      where id = ${fixture.activityId}
    `;
    const auditCount = await harness.sql<{ count: string }[]>`
      select count(*)::text as count
      from activity_audit_logs
      where activity_id = ${fixture.activityId}
        and event_type = 'OWNER_TRANSFERRED'
    `;
    const notificationCount = await harness.sql<{ count: string }[]>`
      select count(*)::text as count
      from notifications
      where recipient_user_id = ${fixture.nextOwnerUserId}
        and type = 'OWNER_TRANSFERRED'
    `;

    expect(members).toEqual([
      { id: fixture.ownerMemberId, role: "OWNER" },
      { id: fixture.nextOwnerMemberId, role: "MEMBER" },
    ]);
    expect(activity).toEqual({
      ownerMemberId: fixture.ownerMemberId,
      revision: "0",
    });
    expect(auditCount).toEqual([{ count: "0" }]);
    expect(notificationCount).toEqual([{ count: "0" }]);
  });

  it("拒绝非当前 Owner 发起的转让", async () => {
    const fixture = await createOwnershipFixture();

    await expect(
      new OwnershipService(harness.sql).transferOwnership(
        fixture.activityId,
        fixture.nextOwnerMemberId,
        fixture.ownerMemberId,
      ),
    ).rejects.toMatchObject({
      code: "ROLE_FORBIDDEN",
      status: 403,
    });
  });

  it("拒绝将所有权转让给自己", async () => {
    const fixture = await createOwnershipFixture();

    await expect(
      new OwnershipService(harness.sql).transferOwnership(
        fixture.activityId,
        fixture.ownerMemberId,
        fixture.ownerMemberId,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_NEW_OWNER",
      status: 422,
    });
  });

  it("将已删除活动视为不存在", async () => {
    const fixture = await createOwnershipFixture();
    await harness.sql`
      update activities set deleted_at = now() where id = ${fixture.activityId}
    `;

    await expect(
      new OwnershipService(harness.sql).transferOwnership(
        fixture.activityId,
        fixture.ownerMemberId,
        fixture.nextOwnerMemberId,
      ),
    ).rejects.toMatchObject({
      code: "ACTIVITY_NOT_FOUND",
      status: 404,
    });
  });
});
