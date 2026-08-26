import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { SystemAdminService } from "@/server/services/system-admin-service";

describe("LAST_ACTIVE_ADMIN", () => {
  let harness: PostgresHarness;

  beforeAll(async () => {
    harness = await startPostgres();
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it("拒绝禁用最后一个可登录系统管理员", async () => {
    await harness.seedCredentialAdmin("admin-1");
    const service = new SystemAdminService(harness.sql);

    await expect(service.disableUser("admin-1")).rejects.toMatchObject({
      code: "LAST_ACTIVE_ADMIN",
      status: 409,
      message: "系统必须至少保留一个能够正常登录的系统管理员。",
    });
  });

  it("存在另一个可登录管理员后允许禁用", async () => {
    await harness.seedCredentialAdmin("admin-2");

    await expect(
      new SystemAdminService(harness.sql).disableUser("admin-1"),
    ).resolves.toBeUndefined();
  });
});
