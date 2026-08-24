import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type PostgresHarness } from "../../support/postgres";

let harness: PostgresHarness;

/** 认证 schema 依赖真实 PostgreSQL 约束，避免用模拟数据库掩盖唯一索引行为。 */
describe("authentication schema", () => {
  beforeAll(async () => {
    harness = await startPostgres();
  }, 60_000);

  afterAll(async () => {
    if (harness) {
      await harness.stop();
    }
  });

  it("seeds singleton settings and rejects duplicate normalized usernames", async () => {
    const [settings] = await harness.sql<
      {
        registrationPolicy: "INVITE_ONLY" | "OPEN";
      }[]
    >`
      select registration_policy as "registrationPolicy"
      from system_settings
      where id = 'singleton'
    `;

    expect(settings.registrationPolicy).toBe("INVITE_ONLY");

    await harness.sql`
      insert into "user" (id, name, email)
      values
        ('user-alice', 'Alice', 'alice@example.test'),
        ('user-alicia', 'Alicia', 'alicia@example.test')
    `;
    await harness.sql`
      insert into user_profiles (user_id, username_normalized, nickname, email_kind)
      values ('user-alice', 'alice', 'Alice', 'SYNTHETIC')
    `;

    await expect(
      harness.sql`
        insert into user_profiles (user_id, username_normalized, nickname, email_kind)
        values ('user-alicia', 'alice', 'Alicia', 'SYNTHETIC')
      `,
    ).rejects.toMatchObject({ code: "23505" });
  });
});
