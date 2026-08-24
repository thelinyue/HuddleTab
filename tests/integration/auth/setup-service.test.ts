import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

import type { Sql } from "postgres";

import type { createDatabaseClient } from "@/server/db/factory";
import { startPostgres, type PostgresHarness } from "../../support/postgres";

const authEnvironmentKeys = [
  "DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
] as const;
const originalEnvironment = new Map<string, string | undefined>();
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
const globalForDb = globalThis as typeof globalThis & {
  database?: DatabaseClient;
};

let harness: PostgresHarness;
let databaseBeforeTest: DatabaseClient | undefined;

function restoreAuthEnvironment() {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function cookieRequestHeader(setCookies: string[]): string {
  return setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

/** Setup 凭据走真实 Better Auth；只有 token 哈希轮换可使用最小假凭据隔离验证。 */
describe("SetupService", () => {
  beforeAll(async () => {
    databaseBeforeTest = globalForDb.database;
    delete globalForDb.database;
    harness = await startPostgres();

    for (const key of authEnvironmentKeys) {
      originalEnvironment.set(key, process.env[key]);
    }
    process.env.DATABASE_URL = harness.connectionUri;
    process.env.BETTER_AUTH_URL = "http://localhost:5660";
    process.env.BETTER_AUTH_SECRET =
      "test-secret-with-at-least-thirty-two-characters";
    vi.resetModules();
  }, 60_000);

  beforeEach(async () => {
    await harness.sql.unsafe(`
      delete from system_roles;
      delete from "user";
      update system_bootstrap
      set setup_token_hash = null, generated_at = null, completed_at = null
      where id = 'singleton';
    `);
  });
  afterAll(async () => {
    try {
      const database = globalForDb.database;
      if (database && database !== databaseBeforeTest) {
        delete globalForDb.database;
        await database.sql.end();
      }
    } finally {
      if (databaseBeforeTest === undefined) {
        delete globalForDb.database;
      } else {
        globalForDb.database = databaseBeforeTest;
      }
      vi.resetModules();
      restoreAuthEnvironment();
      originalEnvironment.clear();
      if (harness) {
        await harness.stop();
      }
    }
  });

  it("每次未初始化启动替换 hash，且旧 token 立即失效", async () => {
    const { SetupService } = await import("@/server/services/setup-service");
    const service = new SetupService(harness.sql, {
      create: vi.fn(),
      compensate: vi.fn(),
    });

    const first = await service.rotateForUninitializedStartup();
    const second = await service.rotateForUninitializedStartup();
    const [row] = await harness.sql<{ setup_token_hash: string }[]>`
      select setup_token_hash from system_bootstrap where id = 'singleton'
    `;

    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(first).not.toBe(second);
    expect(row.setup_token_hash).not.toContain(first!);
    expect(row.setup_token_hash).not.toContain(second!);
    await expect(
      service.claim(first!, {
        username: "old-token-owner",
        password: "valid-password-123",
        nickname: "旧口令",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_SETUP_TOKEN",
      status: 403,
    });
  }, 60_000);

  it("completed_at 已存在时即使角色意外缺失也永久关闭 setup", async () => {
    const { SetupService } = await import("@/server/services/setup-service");
    const service = new SetupService(harness.sql, {
      create: vi.fn(),
      compensate: vi.fn(),
    });
    const fixedCompletedAt = "2001-02-03T04:05:06.789Z";
    const expectedDatabaseTimestamp = "2001-02-03 04:05:06.789+00";
    await harness.sql`
      update system_bootstrap
      set setup_token_hash = 'stale-setup-token-hash', completed_at = ${fixedCompletedAt}
      where id = 'singleton'
    `;
    const [before] = await harness.sql<{ completed_at: string | null }[]>`
      select completed_at from system_bootstrap where id = 'singleton'
    `;

    const token = await service.rotateForUninitializedStartup();
    const [state] = await harness.sql<
      { setup_token_hash: string | null; completed_at: string | null }[]
    >`
      select setup_token_hash, completed_at
      from system_bootstrap
      where id = 'singleton'
    `;

    expect(before.completed_at).toBe(expectedDatabaseTimestamp);
    expect(token).toBeNull();
    expect(state).toMatchObject({ setup_token_hash: null });
    expect(state.completed_at).toBe(expectedDatabaseTimestamp);
    expect(state.completed_at).toBe(before.completed_at);
    expect(await service.isSetupRequired()).toBe(false);
  }, 60_000);

  it("提交确认丢失时核查已提交状态并保留首个管理员", async () => {
    const { SetupService } = await import("@/server/services/setup-service");
    const { createSetupCredentialUser, compensateSetupCredentialUser } =
      await import("@/server/services/registration-service");
    const compensate = vi.fn(compensateSetupCredentialUser);
    const credentials = {
      create: createSetupCredentialUser,
      compensate,
    };
    const token = await new SetupService(
      harness.sql,
      credentials,
    ).rotateForUninitializedStartup();
    const sqlWithCommitAcknowledgementLoss = new Proxy(harness.sql, {
      get(target, property, receiver) {
        if (property === "begin") {
          return async (...args: Parameters<typeof target.begin>) => {
            await target.begin(...args);
            throw new Error("simulated commit acknowledgement lost");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as Sql;
    const service = new SetupService(
      sqlWithCommitAcknowledgementLoss,
      credentials,
    );

    const result = await service.claim(token!, {
      username: "commit-ack-owner",
      password: "valid-password-123",
      nickname: "提交确认管理员",
    });
    const [state] = await harness.sql<
      { has_admin: boolean; completed_at: string | null }[]
    >`
      select exists(
        select 1 from system_roles
        where user_id = ${result.userId} and role = 'system_admin'
      ) as has_admin,
      (select completed_at from system_bootstrap where id = 'singleton') as completed_at
    `;

    expect(result.headers.getSetCookie()).not.toHaveLength(0);
    expect(compensate).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      has_admin: true,
      completed_at: expect.any(String),
    });
    expect(await service.isSetupRequired()).toBe(false);
  }, 60_000);

  it("补偿失败时返回稳定恢复错误且日志不含敏感初始化数据", async () => {
    const { SetupService } = await import("@/server/services/setup-service");
    const userId = "setup-compensation-failure-user";
    const syntheticEmail = "u_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@local.invalid";
    const password = "password-that-must-not-be-logged";
    const cookie = "session=must-not-log";
    await harness.sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${userId}, '补偿失败管理员', ${syntheticEmail}, false, now(), now())
    `;
    const compensate = vi
      .fn()
      .mockRejectedValue(new Error("simulated cleanup failure"));
    const service = new SetupService(harness.sql, {
      create: vi.fn().mockResolvedValue({
        userId,
        headers: new Headers({ "set-cookie": cookie }),
      }),
      compensate,
    });
    const token = await service.rotateForUninitializedStartup();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await harness.sql.unsafe(`
      create function reject_setup_compensation_role_write() returns trigger as $$
      begin
        raise exception 'injected setup role failure';
      end;
      $$ language plpgsql;
      create trigger reject_setup_compensation_role_write
      before insert on system_roles
      for each row execute function reject_setup_compensation_role_write();
    `);

    try {
      await expect(
        service.claim(token!, {
          username: "compensation-failure-owner",
          password,
          nickname: "补偿失败管理员",
        }),
      ).rejects.toMatchObject({
        code: "SETUP_CREDENTIAL_COMPENSATION_FAILED",
        status: 500,
        message: "初始化恢复失败，请部署管理员检查数据库后重试。",
      });
    } finally {
      await harness.sql.unsafe(
        "drop trigger if exists reject_setup_compensation_role_write on system_roles; drop function if exists reject_setup_compensation_role_write();",
      );
    }

    expect(compensate).toHaveBeenCalledWith(userId);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("SETUP_CREDENTIAL_COMPENSATION_FAILED"),
      userId,
    );
    const logText = JSON.stringify(log.mock.calls);
    expect(logText).not.toContain(token!);
    expect(logText).not.toContain(password);
    expect(logText).not.toContain(cookie);
    expect(logText).not.toContain(syntheticEmail);
  }, 60_000);

  it("提交结果核查失败时保留凭据并返回稳定恢复错误", async () => {
    const { SetupService } = await import("@/server/services/setup-service");
    const userId = "setup-outcome-unknown-user";
    await harness.sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${userId}, '结果未知管理员', 'u_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@local.invalid', false, now(), now())
    `;
    const compensate = vi.fn();
    const token = await new SetupService(harness.sql, {
      create: vi.fn().mockResolvedValue({ userId, headers: new Headers() }),
      compensate,
    }).rotateForUninitializedStartup();
    const sqlWithOutcomeReadFailure = new Proxy(harness.sql, {
      get(target, property, receiver) {
        if (property === "begin") return target.begin.bind(target);
        return Reflect.get(target, property, receiver);
      },
      apply() {
        throw new Error("simulated outcome lookup failure");
      },
    }) as Sql;
    const service = new SetupService(sqlWithOutcomeReadFailure, {
      create: vi.fn().mockResolvedValue({ userId, headers: new Headers() }),
      compensate,
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await harness.sql.unsafe(`
      create function reject_setup_outcome_role_write() returns trigger as $$
      begin
        raise exception 'injected setup role failure';
      end;
      $$ language plpgsql;
      create trigger reject_setup_outcome_role_write
      before insert on system_roles
      for each row execute function reject_setup_outcome_role_write();
    `);

    try {
      await expect(
        service.claim(token!, {
          username: "outcome-unknown-owner",
          password: "valid-password-123",
          nickname: "结果未知管理员",
        }),
      ).rejects.toMatchObject({
        code: "SETUP_CLAIM_OUTCOME_UNKNOWN",
        status: 500,
        message: "初始化结果暂时无法确认，请部署管理员检查数据库后重试。",
      });
    } finally {
      await harness.sql.unsafe(
        "drop trigger if exists reject_setup_outcome_role_write on system_roles; drop function if exists reject_setup_outcome_role_write();",
      );
    }

    expect(compensate).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("SETUP_CLAIM_OUTCOME_UNKNOWN"),
      userId,
    );
  }, 60_000);

  it("另一 claim 完成 setup 时仍精确补偿已回滚的并发凭据", async () => {
    const { SetupService } = await import("@/server/services/setup-service");
    const { createSetupCredentialUser, compensateSetupCredentialUser } =
      await import("@/server/services/registration-service");
    const compensate = vi.fn(compensateSetupCredentialUser);
    const credentials = {
      create: createSetupCredentialUser,
      compensate,
    };
    const setupService = new SetupService(harness.sql, credentials);
    const token = await setupService.rotateForUninitializedStartup();
    let releaseOutcomeRead!: () => void;
    const allowOutcomeRead = new Promise<void>((resolve) => {
      releaseOutcomeRead = resolve;
    });
    let markOutcomeReadStarted!: () => void;
    const outcomeReadStarted = new Promise<void>((resolve) => {
      markOutcomeReadStarted = resolve;
    });
    const sqlWithDelayedOutcomeRead = new Proxy(harness.sql, {
      get(target, property, receiver) {
        if (property === "begin") return target.begin.bind(target);
        return Reflect.get(target, property, receiver);
      },
      apply(target, thisArgument, argumentsList) {
        markOutcomeReadStarted();
        return allowOutcomeRead.then(() =>
          Reflect.apply(target, thisArgument, argumentsList),
        );
      },
    }) as Sql;
    const failedService = new SetupService(
      sqlWithDelayedOutcomeRead,
      credentials,
    );
    await harness.sql.unsafe(`
      create function reject_interleaved_setup_a_role_write() returns trigger as $$
      begin
        if exists (
          select 1 from "user"
          where id = new.user_id and username = 'interleaved-setup-a'
        ) then
          raise exception 'injected interleaved A role failure';
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger reject_interleaved_setup_a_role_write
      before insert on system_roles
      for each row execute function reject_interleaved_setup_a_role_write();
    `);

    const failedClaim = failedService.claim(token!, {
      username: "interleaved-setup-a",
      password: "valid-password-123",
      nickname: "并发回滚成员",
    });
    try {
      await outcomeReadStarted;
      const successfulClaim = await setupService.claim(token!, {
        username: "interleaved-setup-b",
        password: "valid-password-123",
        nickname: "并发管理员",
      });
      releaseOutcomeRead();

      await expect(failedClaim).rejects.toThrow(
        "injected interleaved A role failure",
      );
      const { auth } = await import("@/server/auth/auth");
      const session = await auth.api.getSession({
        headers: new Headers({
          cookie: cookieRequestHeader(successfulClaim.headers.getSetCookie()),
        }),
      });
      const [state] = await harness.sql<
        {
          aUsers: number;
          aAccounts: number;
          aProfiles: number;
          aSessions: number;
          bHasAdmin: boolean;
          bUsers: number;
          completedAt: string | null;
        }[]
      >`
        select
          (select count(*)::int from "user" where username = 'interleaved-setup-a') as "aUsers",
          (select count(*)::int from account a join "user" u on u.id = a.user_id where u.username = 'interleaved-setup-a') as "aAccounts",
          (select count(*)::int from user_profiles p join "user" u on u.id = p.user_id where u.username = 'interleaved-setup-a') as "aProfiles",
          (select count(*)::int from session s join "user" u on u.id = s.user_id where u.username = 'interleaved-setup-a') as "aSessions",
          exists(select 1 from system_roles where user_id = ${successfulClaim.userId} and role = 'system_admin') as "bHasAdmin",
          (select count(*)::int from "user" where id = ${successfulClaim.userId}) as "bUsers",
          (select completed_at from system_bootstrap where id = 'singleton') as "completedAt"
      `;

      expect(compensate).toHaveBeenCalledTimes(1);
      expect(compensate).toHaveBeenCalledWith(
        expect.not.stringMatching(successfulClaim.userId),
      );
      expect(successfulClaim.headers.getSetCookie()).not.toHaveLength(0);
      expect(session?.user.id).toBe(successfulClaim.userId);
      expect(state).toMatchObject({
        aUsers: 0,
        aAccounts: 0,
        aProfiles: 0,
        aSessions: 0,
        bHasAdmin: true,
        bUsers: 1,
        completedAt: expect.any(String),
      });
      expect(await setupService.isSetupRequired()).toBe(false);
    } finally {
      releaseOutcomeRead();
      await harness.sql.unsafe(
        "drop trigger if exists reject_interleaved_setup_a_role_write on system_roles; drop function if exists reject_interleaved_setup_a_role_write();",
      );
    }
  }, 60_000);

  it("成功 claim 只创建一个 system admin、清除 hash 并永久关闭 setup", async () => {
    const { SetupService } = await import("@/server/services/setup-service");
    const { createSetupCredentialUser, compensateSetupCredentialUser } =
      await import("@/server/services/registration-service");
    const service = new SetupService(harness.sql, {
      create: createSetupCredentialUser,
      compensate: compensateSetupCredentialUser,
    });
    const token = await service.rotateForUninitializedStartup();

    const result = await service.claim(token!, {
      username: "setup-owner",
      password: "valid-password-123",
      nickname: "初始化管理员",
    });
    const [state] = await harness.sql<
      {
        setup_token_hash: string | null;
        completed_at: string | null;
        admins: number;
      }[]
    >`
      select b.setup_token_hash, b.completed_at,
        (select count(*)::int from system_roles where role = 'system_admin') as admins
      from system_bootstrap b where b.id = 'singleton'
    `;

    expect(result.headers.getSetCookie()).not.toHaveLength(0);
    expect(state).toMatchObject({
      setup_token_hash: null,
      completed_at: expect.any(String),
      admins: 1,
    });
    expect(await service.rotateForUninitializedStartup()).toBeNull();
    await expect(
      service.claim(token!, {
        username: "used-token-owner",
        password: "valid-password-123",
        nickname: "已使用口令",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_SETUP_TOKEN",
      status: 403,
    });
  }, 60_000);

  it("角色写入失败时补偿真实认证、profile 与 session，且不完成初始化", async () => {
    const { SetupService } = await import("@/server/services/setup-service");
    const { createSetupCredentialUser, compensateSetupCredentialUser } =
      await import("@/server/services/registration-service");
    const service = new SetupService(harness.sql, {
      create: createSetupCredentialUser,
      compensate: compensateSetupCredentialUser,
    });
    const token = await service.rotateForUninitializedStartup();
    await harness.sql.unsafe(`
      create function reject_setup_role_write() returns trigger as $$
      begin
        raise exception 'injected setup role failure';
      end;
      $$ language plpgsql;
      create trigger reject_setup_role_write
      before insert on system_roles
      for each row execute function reject_setup_role_write();
    `);

    try {
      await expect(
        service.claim(token!, {
          username: "setup-rollback-owner",
          password: "valid-password-123",
          nickname: "回滚管理员",
        }),
      ).rejects.toThrow("injected setup role failure");
    } finally {
      await harness.sql.unsafe(
        "drop trigger if exists reject_setup_role_write on system_roles; drop function if exists reject_setup_role_write();",
      );
    }

    const [state] = await harness.sql<
      {
        users: number;
        accounts: number;
        profiles: number;
        sessions: number;
        setup_token_hash: string | null;
        completed_at: string | null;
      }[]
    >`
      select
        (select count(*)::int from "user" where username = 'setup-rollback-owner') as users,
        (select count(*)::int from account a join "user" u on u.id = a.user_id where u.username = 'setup-rollback-owner') as accounts,
        (select count(*)::int from user_profiles p join "user" u on u.id = p.user_id where u.username = 'setup-rollback-owner') as profiles,
        (select count(*)::int from session s join "user" u on u.id = s.user_id where u.username = 'setup-rollback-owner') as sessions,
        b.setup_token_hash, b.completed_at
      from system_bootstrap b where b.id = 'singleton'
    `;
    expect(state).toMatchObject({
      users: 0,
      accounts: 0,
      profiles: 0,
      sessions: 0,
      setup_token_hash: expect.any(String),
      completed_at: null,
    });

    await expect(
      service.claim(token!, {
        username: "setup-retry-owner",
        password: "valid-password-123",
        nickname: "重试管理员",
      }),
    ).resolves.toMatchObject({ userId: expect.any(String) });
  }, 60_000);

  it("并发 rotate/claim 只保留一个有效 token，并且只创建一个管理员", async () => {
    const { SetupService } = await import("@/server/services/setup-service");
    const { createSetupCredentialUser, compensateSetupCredentialUser } =
      await import("@/server/services/registration-service");
    const service = new SetupService(harness.sql, {
      create: createSetupCredentialUser,
      compensate: compensateSetupCredentialUser,
    });
    const [first, second] = await Promise.all([
      service.rotateForUninitializedStartup(),
      service.rotateForUninitializedStartup(),
    ]);

    const attempts = await Promise.allSettled([
      service.claim(first!, {
        username: "setup-concurrent-first",
        password: "valid-password-123",
        nickname: "并发一",
      }),
      service.claim(second!, {
        username: "setup-concurrent-second",
        password: "valid-password-123",
        nickname: "并发二",
      }),
    ]);
    const [admins] = await harness.sql<{ count: number }[]>`
      select count(*)::int as count from system_roles where role = 'system_admin'
    `;

    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(admins.count).toBe(1);
  }, 60_000);
});
