import { describe, expect, it } from "vitest";

import { createDatabaseClient } from "@/server/db/factory";

const invalidConnectionStrings = [
  undefined,
  "",
  "   ",
  "mysql://huddletab:test-password@localhost/huddletab",
  "not-a-valid-postgres-url-with-secret",
];

describe("database client factory", () => {
  it.each(invalidConnectionStrings)(
    "rejects an invalid connection string without exposing it: %j",
    (connectionString) => {
      expect(() => createDatabaseClient(connectionString as string)).toThrow(
        "数据库连接配置无效",
      );
      expect(() =>
        createDatabaseClient(connectionString as string),
      ).not.toThrow("test-password");
    },
  );
});
