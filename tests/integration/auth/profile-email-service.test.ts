import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";

let harness: PostgresHarness;

async function createService() {
  const { ProfileEmailService } =
    await import("@/server/services/profile-email-service");
  return new ProfileEmailService(harness.sql);
}

async function resetDatabase(): Promise<void> {
  await harness.sql`delete from session`;
  await harness.sql`delete from account`;
  await harness.sql`delete from system_roles`;
  await harness.sql`delete from user_profiles`;
  await harness.sql`delete from "user"`;
}

/** 真实 PostgreSQL 迁移测试：邮箱和 profile 身份必须在同一事务中改变。 */
describe("ProfileEmailService", () => {
  beforeAll(async () => {
    harness = await startPostgres();
  }, 60_000);

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    if (harness) await harness.stop();
  }, 60_000);

  it("将 synthetic 身份迁移为规范化的未验证真实邮箱，且不返回旧邮箱", async () => {
    await harness.seedCredentialUser(
      "email-user",
      "u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid",
    );
    await harness.sql`
      update "user" set email_verified = true where id = 'email-user'
    `;

    await expect(
      (await createService()).bindRealEmail(
        "email-user",
        " Alice@Example.com ",
      ),
    ).resolves.toBeUndefined();

    const [row] = await harness.sql<
      { email: string; emailVerified: boolean; emailKind: string }[]
    >`
      select u.email, u.email_verified as "emailVerified", p.email_kind as "emailKind"
      from "user" u
      join user_profiles p on p.user_id = u.id
      where u.id = 'email-user'
    `;
    expect(row).toEqual({
      email: "alice@example.com",
      emailVerified: false,
      emailKind: "REAL",
    });
  });

  it("拒绝无效或 local.invalid 邮箱，并保持原身份不变", async () => {
    const originalEmail = "u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid";
    await harness.seedCredentialUser("invalid-email-user", originalEmail);
    const service = await createService();

    for (const email of ["not-an-email", "member@local.invalid"]) {
      await expect(
        service.bindRealEmail("invalid-email-user", email),
      ).rejects.toMatchObject({
        code: "INVALID_REAL_EMAIL",
        message: "请输入可接收邮件的真实邮箱地址。",
        status: 422,
      });
    }

    const [row] = await harness.sql<{ email: string; emailKind: string }[]>`
      select u.email, p.email_kind as "emailKind"
      from "user" u
      join user_profiles p on p.user_id = u.id
      where u.id = 'invalid-email-user'
    `;
    expect(row).toEqual({ email: originalEmail, emailKind: "SYNTHETIC" });
  });

  it("profile 缺失时拒绝绑定并回滚 user 邮箱更新", async () => {
    const originalEmail = "u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid";
    await harness.seedCredentialUser("missing-profile-user", originalEmail);
    await harness.sql`
      update "user" set email_verified = true where id = 'missing-profile-user'
    `;
    await harness.sql`
      delete from user_profiles where user_id = 'missing-profile-user'
    `;

    await expect(
      (await createService()).bindRealEmail(
        "missing-profile-user",
        "member@example.com",
      ),
    ).rejects.toThrow("用户资料缺失，无法绑定真实邮箱。");

    const [state] = await harness.sql<
      { email: string; emailVerified: boolean; emailKind: string | null }[]
    >`
      select u.email, u.email_verified as "emailVerified",
        (select email_kind from user_profiles where user_id = u.id) as "emailKind"
      from "user" u
      where u.id = 'missing-profile-user'
    `;
    expect(state).toEqual({
      email: originalEmail,
      emailVerified: true,
      emailKind: null,
    });
  });

  it("将重复邮箱映射为既有业务错误且不改变任一用户身份", async () => {
    const sourceEmail = "u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid";
    await harness.seedCredentialUser("email-source", sourceEmail);
    await harness.seedCredentialUser("email-owner", "taken@example.com");

    await expect(
      (await createService()).bindRealEmail(
        "email-source",
        " Taken@Example.com ",
      ),
    ).rejects.toMatchObject({
      code: "EMAIL_ALREADY_REGISTERED",
      message: "该邮箱已注册，请使用其他邮箱。",
      status: 409,
    });

    const identities = await harness.sql<
      { id: string; email: string; emailKind: string }[]
    >`
      select u.id, u.email, p.email_kind as "emailKind"
      from "user" u
      join user_profiles p on p.user_id = u.id
      where u.id in ('email-source', 'email-owner')
      order by u.id
    `;
    expect(identities).toEqual([
      { id: "email-owner", email: "taken@example.com", emailKind: "REAL" },
      { id: "email-source", email: sourceEmail, emailKind: "SYNTHETIC" },
    ]);
  });
  it("profile 更新失败时回滚同一事务中的 user 邮箱更新", async () => {
    const originalEmail = "u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid";
    await harness.seedCredentialUser("rollback-email-user", originalEmail);
    await harness.sql.unsafe(`
      create function reject_profile_email_kind_update() returns trigger as $$
      begin
        raise exception 'injected profile email update failure';
      end;
      $$ language plpgsql;
      create trigger reject_profile_email_kind_update
      before update of email_kind on user_profiles
      for each row execute function reject_profile_email_kind_update();
    `);

    try {
      await expect(
        (await createService()).bindRealEmail(
          "rollback-email-user",
          "member@example.com",
        ),
      ).rejects.toThrow("injected profile email update failure");
    } finally {
      await harness.sql.unsafe(
        "drop trigger if exists reject_profile_email_kind_update on user_profiles; drop function if exists reject_profile_email_kind_update();",
      );
    }

    const [row] = await harness.sql<{ email: string; emailKind: string }[]>`
      select u.email, p.email_kind as "emailKind"
      from "user" u
      join user_profiles p on p.user_id = u.id
      where u.id = 'rollback-email-user'
    `;
    expect(row).toEqual({ email: originalEmail, emailKind: "SYNTHETIC" });
  });
});
