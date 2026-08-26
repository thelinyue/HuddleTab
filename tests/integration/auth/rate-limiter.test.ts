import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { RateLimiter } from "@/server/security/rate-limiter";

let harness: PostgresHarness;

beforeAll(async () => {
  harness = await startPostgres();
});

afterAll(async () => {
  await harness?.stop();
});

it("超过窗口上限后返回 429，且数据库不保存原始标识", async () => {
  const limiter = new RateLimiter(harness.sql, "test-rate-limit-secret");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await limiter.consume("SETUP", "203.0.113.8", {
      limit: 5,
      windowSeconds: 600,
    });
  }

  await expect(
    limiter.consume("SETUP", "203.0.113.8", { limit: 5, windowSeconds: 600 }),
  ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  const rows =
    await harness.sql`select bucket_key from security_rate_limit_buckets`;
  expect(rows.map((row) => row.bucket_key)).not.toContain("203.0.113.8");
});
