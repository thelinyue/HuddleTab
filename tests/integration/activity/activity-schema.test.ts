import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type PostgresHarness } from "../../support/postgres";

let harness: PostgresHarness;

/**
 * 活动与成员存在延迟循环外键，必须用真实 PostgreSQL 验证事务提交时的约束行为。
 * 这里保护的错误包括：误去除 deferred 配置、允许多个 Owner，或允许跨活动 Owner 引用。
 */
describe("activity member schema", () => {
  beforeAll(async () => {
    harness = await startPostgres();
  }, 60_000);

  afterAll(async () => {
    if (harness) {
      await harness.stop();
    }
  });

  it("rejects an activity before its initial owner exists", async () => {
    await expect(
      harness.sql`
        insert into activities (
          id, name, base_currency, start_date, status, owner_member_id, invite_mode
        )
        values (
          'activity-without-owner', 'Incomplete activity', 'CNY', '2026-08-26', 'ACTIVE',
          'member-missing-owner', 'DIRECT_JOIN'
        )
      `,
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("creates an activity and its initial owner in one deferred transaction", async () => {
    await harness.sql.begin(async (transaction) => {
      await transaction`
        insert into activities (
          id, name, base_currency, start_date, status, owner_member_id, invite_mode
        )
        values (
          'activity-deferred', 'Deferred activity', 'CNY', '2026-08-26', 'ACTIVE',
          'member-deferred-owner', 'DIRECT_JOIN'
        )
      `;
      await transaction`
        insert into activity_members (
          id, activity_id, display_name, member_type, role
        )
        values (
          'member-deferred-owner', 'activity-deferred', 'Deferred owner', 'GUEST', 'OWNER'
        )
      `;
    });

    const [activity] = await harness.sql<{ ownerMemberId: string }[]>`
      select owner_member_id as "ownerMemberId"
      from activities
      where id = 'activity-deferred'
    `;

    expect(activity.ownerMemberId).toBe("member-deferred-owner");
  });

  it("rejects a second owner for the same activity", async () => {
    await expect(
      harness.sql`
        insert into activity_members (
          id, activity_id, display_name, member_type, role
        )
        values (
          'member-deferred-second-owner', 'activity-deferred', 'Second owner', 'GUEST', 'OWNER'
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects an owner member that belongs to another activity", async () => {
    await harness.sql.begin(async (transaction) => {
      await transaction`
        insert into activities (
          id, name, base_currency, start_date, status, owner_member_id, invite_mode
        )
        values (
          'activity-other', 'Other activity', 'CNY', '2026-08-26', 'ACTIVE',
          'member-other-owner', 'DIRECT_JOIN'
        )
      `;
      await transaction`
        insert into activity_members (
          id, activity_id, display_name, member_type, role
        )
        values (
          'member-other-owner', 'activity-other', 'Other owner', 'GUEST', 'OWNER'
        )
      `;
    });

    await expect(
      harness.sql`
        update activities
        set owner_member_id = 'member-deferred-owner'
        where id = 'activity-other'
      `,
    ).rejects.toMatchObject({ code: "23503" });
  });
});
