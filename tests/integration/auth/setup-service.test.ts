import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

  afterAll(async () => {
    await harness?.stop();
  });

  it("重启时替换旧 Hash，且不持久化明文", async () => {
    const service = new SetupService(harness.sql, {
      create: vi.fn(),
      compensate: vi.fn(),
    });
    const first = await service.rotateForUninitializedStartup();
    const second = await service.rotateForUninitializedStartup();
    const rows =
      await harness.sql`select setup_token_hash from system_bootstrap where id = 'singleton'`;

    expect(first).not.toBe(second);
    expect(rows[0]?.setup_token_hash).not.toContain(second!);
    await expect(
      service.claim(first!, {
        username: "owner",
        password: "password-123",
        nickname: "Owner",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SETUP_TOKEN" });
  });

  it("首次管理员创建成功后永久关闭 Setup", async () => {
    const userId = "setup-admin";
    const service = new SetupService(harness.sql, {
      create: async () => {
        await harness.seedCredentialUser(userId, "setup-admin@local.invalid");
        return { userId };
      },
      compensate: async () => undefined,
    });
    const token = await service.rotateForUninitializedStartup();

    await service.claim(token!, {
      username: "owner",
      password: "password-123",
      nickname: "Owner",
    });

    expect(await service.rotateForUninitializedStartup()).toBeNull();
  });
});
