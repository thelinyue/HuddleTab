import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";

describe("认证与系统表", () => {
  let harness: PostgresHarness;

  beforeAll(async () => {
    harness = await startPostgres();
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it("默认仅邀请注册并保持规范化用户名全局唯一", async () => {
    const setting =
      await harness.sql`select registration_policy from system_settings where id = 'singleton'`;
    expect(setting[0]?.registration_policy).toBe("INVITE_ONLY");

    await harness.sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values ('u1', '甲', 'u_1@local.invalid', false, now(), now()),
             ('u2', '乙', 'u_2@local.invalid', false, now(), now())`;
    await harness.sql`insert into user_profiles (user_id, username_normalized, nickname, email_kind, created_at, updated_at)
      values ('u1', 'alice', '甲', 'SYNTHETIC', now(), now())`;

    await expect(
      harness.sql`insert into user_profiles (user_id, username_normalized, nickname, email_kind, created_at, updated_at)
        values ('u2', 'alice', '乙', 'SYNTHETIC', now(), now())`,
    ).rejects.toMatchObject({ code: "23505" });
  });
});
