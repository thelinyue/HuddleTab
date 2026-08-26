import { expect, it, vi } from "vitest";

const postgres = vi.hoisted(() => vi.fn(() => vi.fn()));

vi.mock("postgres", () => ({ default: postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn() }));

import { createDatabaseClient } from "@/server/db/factory";

/** 完整恢复会重建表结构，长驻连接不得保留会引用旧行类型的 prepared statement。 */
it("数据库客户端关闭 prepared statement 缓存", () => {
  createDatabaseClient("postgresql://test", 3);

  expect(postgres).toHaveBeenCalledWith("postgresql://test", {
    max: 3,
    prepare: false,
  });
});
