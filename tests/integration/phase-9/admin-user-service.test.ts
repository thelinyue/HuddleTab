import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { requireSystemAdmin } from "@/server/permissions/require-system-admin";
import { SystemAdminService } from "@/server/services/system-admin-service";

let harness: PostgresHarness;

function userId(label: string) {
  return `phase-9-${label}-${randomUUID()}`;
}

async function seedSession(user: string) {
  await harness.sql`insert into session (id, token, expires_at, user_id, created_at, updated_at)
    values (${`${user}-session`}, ${`${user}-token`}, now() + interval '1 day', ${user}, now(), now())`;
}

async function loginCapableAdmin(user: string) {
  const [row] = await harness.sql<{ exists: boolean }[]>`
    select exists(
      select 1
      from system_roles sr
      join user_profiles up on up.user_id = sr.user_id and up.disabled_at is null
      join account a on a.user_id = sr.user_id and a.provider_id = 'credential' and a.password is not null
      where sr.user_id = ${user} and sr.role = 'system_admin'
    ) as exists`;
  return Boolean(row?.exists);
}

beforeAll(async () => {
  harness = await startPostgres();
});

afterAll(async () => {
  await harness?.stop();
});

/** 每个用例必须拥有独立的管理员集合，否则前一个用例会掩盖最后管理员不变量。 */
afterEach(async () => {
  if (harness) await harness.sql`delete from "user" where id like 'phase-9-%'`;
});

describe("系统管理员不变量", () => {
  it.each([
    [
      "禁用",
      (service: SystemAdminService, user: string) => service.disableUser(user),
    ],
    [
      "撤销权限",
      (service: SystemAdminService, user: string) =>
        service.revokeSystemAdmin(user),
    ],
    [
      "删除账号",
      (service: SystemAdminService, user: string) => service.deleteUser(user),
    ],
  ])("拒绝对最后一个可登录管理员执行%s", async (_name, operate) => {
    const admin = userId("last-admin");
    await harness.seedCredentialAdmin(admin);
    const service = new SystemAdminService(harness.sql);

    await expect(operate(service, admin)).rejects.toMatchObject({
      status: 409,
      code: "LAST_ACTIVE_ADMIN",
      message: "系统必须至少保留一个能够正常登录的系统管理员。",
    });
    await expect(loginCapableAdmin(admin)).resolves.toBe(true);
  });

  it("禁用用户时撤销其活跃 Session", async () => {
    const actor = userId("actor");
    const target = userId("target");
    await harness.seedCredentialAdmin(actor);
    await harness.seedCredentialUser(target, `${target}@example.com`);
    await seedSession(target);

    await new SystemAdminService(harness.sql).disableUser(target);

    await expect(
      harness.sql`select id from session where user_id = ${target}`,
    ).resolves.toHaveLength(0);
    await expect(
      harness.sql`select disabled_at from user_profiles where user_id = ${target}`,
    ).resolves.toMatchObject([{ disabled_at: expect.anything() }]);
  });

  it("并发撤销两个管理员时至多一个成功", async () => {
    const first = userId("concurrent-first");
    const second = userId("concurrent-second");
    await harness.seedCredentialAdmin(first);
    await harness.seedCredentialAdmin(second);
    const service = new SystemAdminService(harness.sql);

    const results = await Promise.allSettled([
      service.revokeSystemAdmin(first),
      service.revokeSystemAdmin(second),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: { code: "LAST_ACTIVE_ADMIN", status: 409 },
    });
    await expect(
      Promise.all([loginCapableAdmin(first), loginCapableAdmin(second)]),
    ).resolves.toContain(true);
  });

  it("启用用户并幂等授予系统管理员角色", async () => {
    const actor = userId("grant-actor");
    const target = userId("grant-target");
    await harness.seedCredentialAdmin(actor);
    await harness.seedCredentialUser(target, `${target}@example.com`);
    await new SystemAdminService(harness.sql).disableUser(target);
    const service = new SystemAdminService(harness.sql);

    await service.enableUser(target);
    await service.grantSystemAdmin(target, actor);
    await service.grantSystemAdmin(target, actor);

    await expect(
      harness.sql`select disabled_at from user_profiles where user_id = ${target}`,
    ).resolves.toMatchObject([{ disabled_at: null }]);
    await expect(
      harness.sql`select user_id from system_roles where user_id = ${target} and role = 'system_admin'`,
    ).resolves.toHaveLength(1);
  });
});

describe("requireSystemAdmin", () => {
  it("只根据 Session、平台角色和账号状态授权，不读取活动身份", async () => {
    const admin = userId("guard-admin");
    const normal = userId("guard-normal");
    const disabled = userId("guard-disabled");
    await harness.seedCredentialAdmin(admin);
    await harness.seedCredentialUser(normal, `${normal}@example.com`);
    await harness.seedCredentialAdmin(disabled);
    await new SystemAdminService(harness.sql).disableUser(disabled);

    await expect(
      requireSystemAdmin(harness.sql, { user: { id: admin } }),
    ).resolves.toBe(admin);
    await expect(
      requireSystemAdmin(harness.sql, { user: { id: normal } }),
    ).rejects.toMatchObject({ status: 403, code: "SYSTEM_ADMIN_REQUIRED" });
    await expect(
      requireSystemAdmin(harness.sql, { user: { id: disabled } }),
    ).rejects.toMatchObject({
      status: 403,
      code: "ACCOUNT_DISABLED",
      message: "账号已被禁用，无法执行系统管理操作。",
    });
  });
});
