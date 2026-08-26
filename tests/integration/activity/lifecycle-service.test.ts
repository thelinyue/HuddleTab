import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActivityLifecycleService } from "@/server/services/activity-lifecycle-service";
import { ActivityService } from "@/server/services/activity-service";
import { MemberService } from "@/server/services/member-service";
import { startPostgres, type PostgresHarness } from "../../support/postgres";

let harness: PostgresHarness;

type LifecycleFixture = {
  activityId: string;
  ownerMemberId: string;
  ownerUserId: string;
  adminMemberId: string;
  adminUserId: string;
  memberMemberId: string;
  leftMemberId: string;
};

async function createLifecycleFixture(): Promise<LifecycleFixture> {
  const ownerUserId = `lifecycle-owner-${randomUUID()}`;
  const adminUserId = `lifecycle-admin-${randomUUID()}`;
  await harness.seedCredentialUser(ownerUserId, `${ownerUserId}@example.com`);
  await harness.seedCredentialUser(adminUserId, `${adminUserId}@example.com`);

  const activity = await new ActivityService(harness.sql).create({
    name: `生命周期测试-${randomUUID()}`,
    baseCurrency: "CNY",
    startDate: "2026-08-26",
    ownerUserId,
    ownerDisplayName: "Owner",
  });
  const members = new MemberService(harness.sql, {
    async hasFacts() {
      return false;
    },
  });
  const admin = await members.addGuest(activity.id, "Admin");
  await members.bindGuest(admin.id, adminUserId);
  const member = await members.addGuest(activity.id, "Member");
  const leftMember = await members.addGuest(activity.id, "Left");
  await members.leave(leftMember.id);
  await harness.sql`
    update activity_members set role = 'ADMIN' where id = ${admin.id}
  `;
  await harness.sql`
    update activities set revision = 0 where id = ${activity.id}
  `;

  return {
    activityId: activity.id,
    ownerMemberId: activity.ownerMemberId,
    ownerUserId,
    adminMemberId: admin.id,
    adminUserId,
    memberMemberId: member.id,
    leftMemberId: leftMember.id,
  };
}

beforeAll(async () => {
  harness = await startPostgres();
});

afterAll(async () => {
  await harness.stop();
});

describe("ActivityLifecycleService.transition", () => {
  it("在事务内完成状态链、删除恢复、审计和一次 revision 递增", async () => {
    const fixture = await createLifecycleFixture();
    const service = new ActivityLifecycleService(harness.sql);

    await harness.sql.begin(async (transaction) => {
      await new ActivityLifecycleService(transaction).transition(
        fixture.activityId,
        fixture.adminMemberId,
        "END",
      );
    });
    await service.transition(
      fixture.activityId,
      fixture.ownerMemberId,
      "ARCHIVE",
    );
    await service.transition(
      fixture.activityId,
      fixture.ownerMemberId,
      "DELETE",
    );
    await service.transition(
      fixture.activityId,
      fixture.ownerMemberId,
      "RESTORE",
    );

    const [activity] = await harness.sql<
      {
        status: string;
        deletedAt: Date | null;
        purgeAfter: Date | null;
        revision: string;
      }[]
    >`
      select
        status,
        deleted_at as "deletedAt",
        purge_after as "purgeAfter",
        revision::text as revision
      from activities
      where id = ${fixture.activityId}
    `;
    const audits = await harness.sql<
      {
        eventType: string;
        actorUserId: string | null;
        actorMemberId: string | null;
        targetType: string;
        targetId: string;
        metadata: Record<string, unknown>;
      }[]
    >`
      select
        event_type as "eventType",
        actor_user_id as "actorUserId",
        actor_member_id as "actorMemberId",
        target_type as "targetType",
        target_id as "targetId",
        metadata
      from activity_audit_logs
      where activity_id = ${fixture.activityId}
        and event_type like 'ACTIVITY_%'
        and event_type <> 'ACTIVITY_CREATED'
      order by created_at
    `;

    expect(activity).toEqual({
      status: "ARCHIVED",
      deletedAt: null,
      purgeAfter: null,
      revision: "4",
    });
    expect(audits).toEqual([
      {
        eventType: "ACTIVITY_END",
        actorUserId: fixture.adminUserId,
        actorMemberId: fixture.adminMemberId,
        targetType: "ACTIVITY",
        targetId: fixture.activityId,
        metadata: {},
      },
      {
        eventType: "ACTIVITY_ARCHIVE",
        actorUserId: fixture.ownerUserId,
        actorMemberId: fixture.ownerMemberId,
        targetType: "ACTIVITY",
        targetId: fixture.activityId,
        metadata: {},
      },
      {
        eventType: "ACTIVITY_DELETE",
        actorUserId: fixture.ownerUserId,
        actorMemberId: fixture.ownerMemberId,
        targetType: "ACTIVITY",
        targetId: fixture.activityId,
        metadata: {},
      },
      {
        eventType: "ACTIVITY_RESTORE",
        actorUserId: fixture.ownerUserId,
        actorMemberId: fixture.ownerMemberId,
        targetType: "ACTIVITY",
        targetId: fixture.activityId,
        metadata: {},
      },
    ]);
  });

  it.each([
    ["Admin", "adminMemberId", "adminUserId"],
    ["Owner", "ownerMemberId", "ownerUserId"],
  ] as const)(
    "允许 %s 将 ENDED 重开为 ACTIVE",
    async (_, memberKey, userKey) => {
      const fixture = await createLifecycleFixture();
      const service = new ActivityLifecycleService(harness.sql);
      const actorMemberId = fixture[memberKey];
      const actorUserId = fixture[userKey];

      await service.transition(
        fixture.activityId,
        fixture.ownerMemberId,
        "END",
      );
      await service.transition(fixture.activityId, actorMemberId, "REOPEN");

      const [activity] = await harness.sql<
        { status: string; revision: string }[]
      >`
      select status, revision::text as revision
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
        and event_type = 'ACTIVITY_REOPEN'
    `;

      expect(activity).toEqual({ status: "ACTIVE", revision: "2" });
      expect(audit).toEqual({
        actorUserId,
        actorMemberId,
        eventType: "ACTIVITY_REOPEN",
        targetType: "ACTIVITY",
        targetId: fixture.activityId,
        metadata: {},
      });
    },
  );

  it("允许 Owner 将 ARCHIVED 解归档为 ENDED", async () => {
    const fixture = await createLifecycleFixture();
    const service = new ActivityLifecycleService(harness.sql);

    await service.transition(fixture.activityId, fixture.ownerMemberId, "END");
    await service.transition(
      fixture.activityId,
      fixture.ownerMemberId,
      "ARCHIVE",
    );
    await service.transition(
      fixture.activityId,
      fixture.ownerMemberId,
      "UNARCHIVE",
    );

    const [activity] = await harness.sql<
      { status: string; revision: string }[]
    >`
      select status, revision::text as revision
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
        and event_type = 'ACTIVITY_UNARCHIVE'
    `;

    expect(activity).toEqual({ status: "ENDED", revision: "3" });
    expect(audit).toEqual({
      actorUserId: fixture.ownerUserId,
      actorMemberId: fixture.ownerMemberId,
      eventType: "ACTIVITY_UNARCHIVE",
      targetType: "ACTIVITY",
      targetId: fixture.activityId,
      metadata: {},
    });
  });

  it("拒绝普通成员、LEFT 成员和非法状态转换，且不产生写入", async () => {
    const fixture = await createLifecycleFixture();
    const service = new ActivityLifecycleService(harness.sql);

    await expect(
      service.transition(fixture.activityId, fixture.memberMemberId, "END"),
    ).rejects.toMatchObject({ code: "ROLE_FORBIDDEN", status: 403 });
    await expect(
      service.transition(fixture.activityId, fixture.leftMemberId, "END"),
    ).rejects.toMatchObject({ code: "LEFT_MEMBER_READ_ONLY", status: 403 });
    await expect(
      service.transition(fixture.activityId, fixture.ownerMemberId, "ARCHIVE"),
    ).rejects.toMatchObject({
      code: "INVALID_ACTIVITY_TRANSITION",
      status: 409,
    });

    const [activity] = await harness.sql<
      { status: string; revision: string }[]
    >`
      select status, revision::text as revision
      from activities
      where id = ${fixture.activityId}
    `;
    const auditCount = await harness.sql<{ count: string }[]>`
      select count(*)::text as count
      from activity_audit_logs
      where activity_id = ${fixture.activityId}
        and event_type <> 'ACTIVITY_CREATED'
    `;
    expect(activity).toEqual({ status: "ACTIVE", revision: "0" });
    expect(auditCount).toEqual([{ count: "0" }]);
  });

  it("删除恢复期过期时保留删除状态且不追加审计", async () => {
    const fixture = await createLifecycleFixture();
    const service = new ActivityLifecycleService(harness.sql);

    await service.transition(
      fixture.activityId,
      fixture.ownerMemberId,
      "DELETE",
    );
    await harness.sql`
      update activities
      set purge_after = now() - interval '1 second'
      where id = ${fixture.activityId}
    `;

    await expect(
      service.transition(fixture.activityId, fixture.ownerMemberId, "RESTORE"),
    ).rejects.toMatchObject({ code: "RESTORE_WINDOW_EXPIRED", status: 409 });

    const [activity] = await harness.sql<
      { deletedAt: Date | null; purgeAfter: Date | null; revision: string }[]
    >`
      select
        deleted_at as "deletedAt",
        purge_after as "purgeAfter",
        revision::text as revision
      from activities
      where id = ${fixture.activityId}
    `;
    const auditCount = await harness.sql<{ count: string }[]>`
      select count(*)::text as count
      from activity_audit_logs
      where activity_id = ${fixture.activityId}
        and event_type like 'ACTIVITY_%'
        and event_type <> 'ACTIVITY_CREATED'
    `;
    expect(activity.deletedAt).not.toBeNull();
    expect(activity.purgeAfter).not.toBeNull();
    expect(activity.revision).toBe("1");
    expect(auditCount).toEqual([{ count: "1" }]);
  });

  it("审计写入失败时回滚状态和 revision", async () => {
    const fixture = await createLifecycleFixture();
    const service = new ActivityLifecycleService(harness.sql);

    try {
      await harness.sql`
        create function fail_lifecycle_audit()
        returns trigger
        language plpgsql
        as $$
        begin
          raise exception '活动审计写入失败' using errcode = 'P0001';
          return new;
        end;
        $$
      `;
      await harness.sql`
        create trigger lifecycle_audit_failure
        before insert on activity_audit_logs
        for each row
        when (new.event_type = 'ACTIVITY_END')
        execute function fail_lifecycle_audit()
      `;
      await expect(
        service.transition(fixture.activityId, fixture.ownerMemberId, "END"),
      ).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("活动审计写入失败"),
      });
    } finally {
      await harness.sql`
        drop trigger if exists lifecycle_audit_failure on activity_audit_logs
      `;
      await harness.sql`drop function if exists fail_lifecycle_audit()`;
    }

    const [activity] = await harness.sql<
      { status: string; revision: string }[]
    >`
      select status, revision::text as revision
      from activities
      where id = ${fixture.activityId}
    `;
    const auditCount = await harness.sql<{ count: string }[]>`
      select count(*)::text as count
      from activity_audit_logs
      where activity_id = ${fixture.activityId}
        and event_type = 'ACTIVITY_END'
    `;
    expect(activity).toEqual({ status: "ACTIVE", revision: "0" });
    expect(auditCount).toEqual([{ count: "0" }]);
  });
});
