import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ getDatabaseClient: vi.fn() }));

import { GET } from "@/app/api/health/route";
import { getDatabaseClient } from "@/server/db";

/** 健康检查只依赖获取器和最小查询能力，避免测试展开 postgres.js 的复杂类型。 */
const getDatabaseClientMock = getDatabaseClient as unknown as {
  mockReset(): void;
  mockReturnValueOnce(value: { sql: unknown }): void;
  mockImplementationOnce(callback: () => never): void;
};

function sqlThatResolves() {
  return vi.fn().mockResolvedValue([]);
}

function sqlThatRejects() {
  return vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
}

describe("health route", () => {
  beforeEach(() => {
    getDatabaseClientMock.mockReset();
  });

  it("returns ok when PostgreSQL is available", async () => {
    getDatabaseClientMock.mockReturnValueOnce({ sql: sqlThatResolves() });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns a deployer-friendly error when PostgreSQL is unavailable", async () => {
    getDatabaseClientMock.mockReturnValueOnce({ sql: sqlThatRejects() });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      message: "数据库连接不可用",
    });
  });

  it("returns the same error when the database configuration cannot be loaded", async () => {
    getDatabaseClientMock.mockImplementationOnce(() => {
      throw new Error("数据库连接配置无效");
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      message: "数据库连接不可用",
    });
  });
});
