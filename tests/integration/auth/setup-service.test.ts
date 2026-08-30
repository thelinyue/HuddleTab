import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { SetupService } from "@/server/services/setup-service";

describe("SetupService", () => {
  let harness: PostgresHarness;

  beforeAll(async () => {
    harness = await startPostgres();
  });

  beforeEach(async () => {
    await harness.sql`delete from system_roles
      where user_id in ('setup-admin', 'concurrent-setup-1', 'concurrent-setup-2')`;
    await harness.sql`delete from account
      where user_id in ('setup-admin', 'concurrent-setup-1', 'concurrent-setup-2')`;
    await harness.sql`delete from user_profiles
      where user_id in ('setup-admin', 'concurrent-setup-1', 'concurrent-setup-2')`;
    await harness.sql`delete from "user"
      where id in ('setup-admin', 'concurrent-setup-1', 'concurrent-setup-2')`;
    await harness.sql`update system_bootstrap
      set completed_at = null where id = 'singleton'`;
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it("首次管理员创建成功后永久关闭 Setup", async () => {
    const userId = "setup-admin";
    const service = new SetupService(harness.sql, {
      create: async () => {
        await harness.seedCredentialUser(userId, "setup-admin@local.invalid");
        return { userId };
      },
      compensate: vi.fn(),
    });

    await service.claim({
      username: "owner",
      password: "password-123",
      nickname: "Owner",
    });

    await expect(
      service.claim({
        username: "owner",
        password: "password-123",
        nickname: "Owner",
      }),
    ).rejects.toMatchObject({ code: "SETUP_COMPLETED" });
  });

  it("创建管理员失败时不会标记初始化完成", async () => {
    const service = new SetupService(harness.sql, {
      create: vi.fn().mockRejectedValue(new Error("凭证创建失败")),
      compensate: async () => undefined,
    });

    await expect(
      service.claim({
        username: "owner",
        password: "password-123",
        nickname: "Owner",
      }),
    ).rejects.toThrow("凭证创建失败");

    const [bootstrap] =
      await harness.sql`select completed_at from system_bootstrap where id = 'singleton'`;
    expect(bootstrap?.completed_at).toBeNull();
  });

  it("并发初始化只有一个请求能够创建首位管理员", async () => {
    let sequence = 0;
    const service = new SetupService(harness.sql, {
      create: async () => {
        sequence += 1;
        const userId = `concurrent-setup-${sequence}`;
        await harness.seedCredentialUser(userId, `${userId}@local.invalid`);
        return { userId };
      },
      compensate: async () => undefined,
    });
    const input = {
      username: "owner",
      password: "password-123",
      nickname: "Owner",
    };

    const results = await Promise.allSettled([
      service.claim(input),
      service.claim(input),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });
});
