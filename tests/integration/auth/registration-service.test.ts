import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { RegistrationService } from "@/server/services/registration-service";

describe("注册服务", () => {
  let harness: PostgresHarness;

  beforeAll(async () => {
    harness = await startPostgres();
    await harness.sql`update system_settings set registration_policy = 'OPEN' where id = 'singleton'`;
    await harness.seedCredentialUser(
      "new-user",
      "u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid",
    );
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it("保存 Synthetic Profile 且不返回内部邮箱", async () => {
    const service = new RegistrationService(
      { verify: async () => false },
      {
        database: harness.db,
        credentials: {
          signUpEmail: async () => ({ user: { id: "new-user" } }),
        },
      },
    );

    const result = await service.register({
      username: "Alice",
      password: "password-123",
      nickname: "小艾",
    });
    const [profile] =
      await harness.sql`select email_kind from user_profiles where user_id = 'new-user'`;

    expect(profile?.email_kind).toBe("SYNTHETIC");
    expect(result).toEqual({
      id: "new-user",
      username: "alice",
      nickname: "小艾",
    });
    expect(result).not.toHaveProperty("email");
  });
});
