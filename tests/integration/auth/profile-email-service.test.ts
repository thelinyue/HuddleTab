import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ProfileEmailService } from "@/server/services/profile-email-service";

let harness: PostgresHarness;

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser(
    "user-1",
    "u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid",
  );
});

afterAll(async () => {
  await harness?.stop();
});

it("将 Synthetic 身份迁移为未验证真实邮箱，不暴露旧地址", async () => {
  await new ProfileEmailService(harness.sql).bindRealEmail(
    "user-1",
    "Alice@Example.com",
  );
  const [row] =
    await harness.sql`select u.email, u.email_verified, p.email_kind from "user" u join user_profiles p on p.user_id = u.id where u.id = 'user-1'`;

  expect(row).toEqual({
    email: "alice@example.com",
    email_verified: false,
    email_kind: "REAL",
  });
});
