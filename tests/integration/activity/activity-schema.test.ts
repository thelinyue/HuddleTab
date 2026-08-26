import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";

describe("活动 Owner 数据库不变量", () => {
  let harness: PostgresHarness;

  beforeAll(async () => {
    harness = await startPostgres();
    await harness.seedCredentialUser("owner-user", "owner@example.com");
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it("仅允许在同一个延迟约束事务中创建活动与初始 Owner", async () => {
    await harness.sql.begin(async (transaction) => {
      await transaction`insert into activities (id, name, base_currency, start_date, status, owner_member_id, invite_mode, revision, created_at, updated_at)
        values ('act-1', '大阪', 'CNY', '2026-08-23', 'ACTIVE', 'member-owner', 'DIRECT_JOIN', 0, now(), now())`;
      await transaction`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at)
        values ('member-owner', 'act-1', 'owner-user', 'Owner', 'USER', 'OWNER', 'ACTIVE', now())`;
    });

    const rows =
      await harness.sql`select owner_member_id from activities where id = 'act-1'`;
    expect(rows[0]?.owner_member_id).toBe("member-owner");
  });

  it("拒绝第二个 Owner 和跨活动 Owner 引用", async () => {
    await expect(
      harness.sql`insert into activity_members (id, activity_id, display_name, member_type, role, status, joined_at)
        values ('owner-2', 'act-1', '二号', 'GUEST', 'OWNER', 'ACTIVE', now())`,
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      harness.sql.begin(async (transaction) => {
        await transaction`insert into activities (id, name, base_currency, start_date, status, owner_member_id, invite_mode, revision, created_at, updated_at)
          values ('act-2', '上海', 'CNY', '2026-08-23', 'ACTIVE', 'member-owner', 'DIRECT_JOIN', 0, now(), now())`;
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
