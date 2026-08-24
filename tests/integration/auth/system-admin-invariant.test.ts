import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";

let harness: PostgresHarness;

async function createService(sql: Sql = harness.sql) {
  const { SystemAdminService } =
    await import("@/server/services/system-admin-service");
  return new SystemAdminService(sql);
}

async function resetDatabase(): Promise<void> {
  await harness.sql`delete from session`;
  await harness.sql`delete from account`;
  await harness.sql`delete from system_roles`;
  await harness.sql`delete from user_profiles`;
  await harness.sql`delete from "user"`;
}

async function seedSession(userId: string): Promise<void> {
  await harness.sql`
    insert into session (id, token, expires_at, user_id, created_at, updated_at)
    values (${`session-${userId}`}, ${`token-${userId}`}, now() + interval '1 hour', ${userId}, now(), now())
  `;
}

async function countLoginCapableAdmins(
  sql: Sql = harness.sql,
): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(distinct sr.user_id)::int as count
    from system_roles sr
    join user_profiles up on up.user_id = sr.user_id and up.disabled_at is null
    join account a on a.user_id = sr.user_id
      and a.provider_id = 'credential'
      and a.password is not null
    where sr.role = 'system_admin'
  `;
  return row?.count ?? 0;
}

/**
 * 这些测试直接对正式迁移后的 PostgreSQL 执行破坏性管理员操作，验证不变量位于
 * Service/Transaction 层而非 UI。两个独立 SQL 连接用于真实并发，避免连接池串行化掩盖锁行为。
 */
describe("LAST_ACTIVE_ADMIN", () => {
  beforeAll(async () => {
    harness = await startPostgres();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await harness.stop();
  });

  it("拒绝禁用、撤销或删除最后一个可登录系统管理员", async () => {
    await harness.seedCredentialAdmin("last-admin");
    await seedSession("last-admin");
    const service = await createService();

    for (const operation of [
      () => service.disableUser("last-admin"),
      () => service.revokeSystemAdmin("last-admin"),
      () => service.deleteUser("last-admin"),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        code: "LAST_ACTIVE_ADMIN",
        message: "系统必须至少保留一个能够正常登录的系统管理员。",
        status: 409,
      });
    }

    expect(await countLoginCapableAdmins()).toBe(1);
    const [state] = await harness.sql<{ sessions: number; users: number }[]>`
      select
        (select count(*)::int from session where user_id = 'last-admin') as sessions,
        (select count(*)::int from "user" where id = 'last-admin') as users
    `;
    expect(state).toEqual({ sessions: 1, users: 1 });
  });

  it("存在另一个可登录管理员时允许禁用，并在事务内清理 session", async () => {
    await harness.seedCredentialAdmin("disable-target");
    await harness.seedCredentialAdmin("disable-backup");
    await seedSession("disable-target");

    await (await createService()).disableUser("disable-target");

    const [state] = await harness.sql<
      { disabledAt: string | null; sessions: number }[]
    >`
      select
        (select disabled_at from user_profiles where user_id = 'disable-target') as "disabledAt",
        (select count(*)::int from session where user_id = 'disable-target') as sessions
    `;
    expect(state).toMatchObject({
      disabledAt: expect.any(String),
      sessions: 0,
    });
    expect(await countLoginCapableAdmins()).toBe(1);
  });

  it("存在另一个可登录管理员时允许撤销系统管理员角色，并在事务内清理 session", async () => {
    await harness.seedCredentialAdmin("revoke-target");
    await harness.seedCredentialAdmin("revoke-backup");
    await seedSession("revoke-target");

    await (await createService()).revokeSystemAdmin("revoke-target");

    const [state] = await harness.sql<
      { hasAdmin: boolean; sessions: number }[]
    >`
      select
        exists(select 1 from system_roles where user_id = 'revoke-target' and role = 'system_admin') as "hasAdmin",
        (select count(*)::int from session where user_id = 'revoke-target') as sessions
    `;
    expect(state).toEqual({ hasAdmin: false, sessions: 0 });
    expect(await countLoginCapableAdmins()).toBe(1);
  });

  it("存在另一个可登录管理员时允许删除账号，并由外键清理关联数据", async () => {
    await harness.seedCredentialAdmin("delete-target");
    await harness.seedCredentialAdmin("delete-backup");
    await seedSession("delete-target");

    await (await createService()).deleteUser("delete-target");

    const [state] = await harness.sql<
      {
        users: number;
        accounts: number;
        profiles: number;
        roles: number;
        sessions: number;
      }[]
    >`
      select
        (select count(*)::int from "user" where id = 'delete-target') as users,
        (select count(*)::int from account where user_id = 'delete-target') as accounts,
        (select count(*)::int from user_profiles where user_id = 'delete-target') as profiles,
        (select count(*)::int from system_roles where user_id = 'delete-target') as roles,
        (select count(*)::int from session where user_id = 'delete-target') as sessions
    `;
    expect(state).toEqual({
      users: 0,
      accounts: 0,
      profiles: 0,
      roles: 0,
      sessions: 0,
    });
    expect(await countLoginCapableAdmins()).toBe(1);
  });

  it("按操作后可登录管理员总数处理非管理员、已禁用和无 credential 的管理员", async () => {
    await harness.seedCredentialAdmin("active-admin");
    await harness.seedCredentialAdmin("ordinary-user");
    await harness.sql`
      delete from system_roles
      where user_id = 'ordinary-user' and role = 'system_admin'
    `;
    await harness.seedCredentialAdmin("disabled-admin");
    await harness.sql`
      update user_profiles
      set disabled_at = now()
      where user_id = 'disabled-admin'
    `;
    await harness.seedCredentialAdmin("passwordless-admin");
    await harness.sql`
      delete from account where user_id = 'passwordless-admin'
    `;

    const service = await createService();
    await expect(service.disableUser("ordinary-user")).resolves.toBeUndefined();
    await expect(
      service.revokeSystemAdmin("passwordless-admin"),
    ).resolves.toBeUndefined();
    await expect(service.deleteUser("disabled-admin")).resolves.toBeUndefined();

    expect(await countLoginCapableAdmins()).toBe(1);
  });

  it("并发破坏性操作最多一个成功，并始终保留一个可登录管理员", async () => {
    await harness.seedCredentialAdmin("concurrent-a");
    await harness.seedCredentialAdmin("concurrent-b");
    const firstSql = postgres(harness.connectionUri, { max: 1 });
    const secondSql = postgres(harness.connectionUri, { max: 1 });

    try {
      const [first, second] = await Promise.allSettled([
        (await createService(firstSql)).disableUser("concurrent-a"),
        (await createService(secondSql)).revokeSystemAdmin("concurrent-b"),
      ]);

      expect(
        [first, second].filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(await countLoginCapableAdmins()).toBe(1);
    } finally {
      await Promise.all([firstSql.end(), secondSql.end()]);
    }
  });
});
