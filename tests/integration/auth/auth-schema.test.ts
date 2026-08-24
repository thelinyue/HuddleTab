import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { startPostgres, type PostgresHarness } from "../../support/postgres";

let harness: PostgresHarness;

/** 认证 schema 依赖真实 PostgreSQL 约束，避免用模拟数据库掩盖唯一索引行为。 */
describe("authentication schema", () => {
  beforeAll(async () => {
    harness = await startPostgres();
    await harness.sql`
      insert into "user" (id, name, email)
      values ('user-account', 'Account User', 'account@example.test')
    `;
  }, 60_000);

  afterAll(async () => {
    if (harness) {
      await harness.stop();
    }
  });

  it("exposes Better Auth singular schema aliases", () => {
    expect(schema.user).toBe(schema.users);
    expect(schema.session).toBe(schema.sessions);
    expect(schema.account).toBe(schema.accounts);
    expect(schema.verification).toBe(schema.verifications);
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

  it("stores accounts with an issuer and rejects duplicate issuer account IDs", async () => {
    await harness.sql`
      insert into account (id, account_id, provider_id, issuer, user_id)
      values ('account-primary', 'provider-account-1', 'github', 'https://github.com', 'user-account')
    `;

    await expect(
      harness.sql`
        insert into account (id, account_id, provider_id, issuer, user_id)
        values ('account-duplicate', 'provider-account-1', 'github', 'https://github.com', 'user-account')
      `,
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects null verification timestamps", async () => {
    await expect(
      harness.sql`
        insert into verification (id, identifier, value, expires_at, created_at, updated_at)
        values ('verification-null-timestamps', 'alice@example.test', 'verification-value', now(), null, null)
      `,
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("creates Better Auth lookup indexes", async () => {
    const indexes = await harness.sql<{ indexName: string }[]>`
      select indexname as "indexName"
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'session_user_id_idx',
          'account_user_id_idx',
          'verification_identifier_idx'
        )
    `;

    expect(indexes.map((entry) => entry.indexName)).toEqual(
      expect.arrayContaining([
        "session_user_id_idx",
        "account_user_id_idx",
        "verification_identifier_idx",
      ]),
    );
  });

  it("rejects non-singleton system settings", async () => {
    await expect(
      harness.sql`
        insert into system_settings (id) values ('not-singleton-settings')
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects non-singleton system bootstrap records", async () => {
    await expect(
      harness.sql`
        insert into system_bootstrap (id) values ('not-singleton-bootstrap')
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });
});
