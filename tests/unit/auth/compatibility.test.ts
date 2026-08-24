import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";
import { normalizeUsername } from "@/server/auth/username";
import {
  createSyntheticEmail,
  isSyntheticEmail,
} from "@/server/auth/synthetic-email";

function expectApplicationError(
  callback: () => unknown,
  expected: { code: string; message?: string; status: number },
) {
  try {
    callback();
  } catch (error) {
    expect(error).toMatchObject(expected);
    return;
  }

  throw new Error("预期抛出 ApplicationError");
}

describe("ApplicationError", () => {
  it("保留应用错误的稳定字段", () => {
    const error = new ApplicationError("INVALID_USERNAME", "用户名无效", 422, {
      field: "username",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApplicationError");
    expect(error.code).toBe("INVALID_USERNAME");
    expect(error.status).toBe(422);
    expect(error.details).toEqual({ field: "username" });
  });

  it("默认提供空错误详情", () => {
    const error = new ApplicationError("INVALID_USERNAME", "用户名无效", 422);

    expect(error.details).toEqual({});
  });
});

describe("用户名规范化", () => {
  it("规范化用户名以支持全局唯一比较", () => {
    expect(normalizeUsername("  Alice_01  ")).toBe("alice_01");
  });

  it("使用 NFKC 与英文小写生成唯一 canonical 值", () => {
    expect(normalizeUsername("ＡLICE＿０１")).toBe("alice_01");
  });

  it.each(["ab", "a".repeat(33)])("拒绝长度不在边界内的用户名: %s", (value) => {
    expectApplicationError(() => normalizeUsername(value), {
      code: "INVALID_USERNAME",
      message: "用户名长度必须为 3 到 32 个字符。",
      status: 422,
    });
  });

  it.each(["a b", "a@b"])("拒绝含内部空白或 @ 的用户名: %s", (value) => {
    expectApplicationError(() => normalizeUsername(value), {
      code: "INVALID_USERNAME",
      message: "用户名不能包含空白或 @。",
      status: 422,
    });
  });

  it("将运行时非字符串输入转换为稳定应用错误", () => {
    expectApplicationError(() => normalizeUsername(null), {
      code: "INVALID_USERNAME",
      status: 422,
    });
  });
});

describe("内部邮箱兼容性", () => {
  it("为内部用户标识创建不可投递邮箱", () => {
    const email = createSyntheticEmail("018f1f67-5b1e-7f41-b0d1-3a013d9c9001");

    expect(email).toBe("u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid");
    expect(isSyntheticEmail(email)).toBe(true);
    expect(isSyntheticEmail("real@example.com")).toBe(false);
  });

  it("拒绝无法构成 32 位十六进制标识的内部邮箱输入", () => {
    expect(() => createSyntheticEmail("not-a-valid-id")).toThrow(
      "生成内部邮箱时收到无效标识",
    );
  });

  it("仅将严格匹配的内部邮箱识别为 synthetic", () => {
    expect(
      isSyntheticEmail("u_018f1f675b1e7f41b0d13a013d9c9001@LOCAL.INVALID"),
    ).toBe(false);
    expect(
      isSyntheticEmail(
        "u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid.extra",
      ),
    ).toBe(false);
    expect(isSyntheticEmail(null)).toBe(false);
  });
});

const execFileAsync = promisify(execFile);
const authRuntimeEntrypoint = resolve("src/server/auth/auth.ts");
const authRouteEntrypoint = resolve("src/app/api/auth/[...all]/route.ts");

function environmentWithoutAuthRuntimeConfiguration(): NodeJS.ProcessEnv {
  const environment = { ...process.env };

  delete environment.AUTH_SECRET;
  delete environment.BETTER_AUTH_SECRET;
  delete environment.BETTER_AUTH_SECRETS;
  delete environment.DATABASE_URL;
  environment.NODE_ENV = "production";

  return environment;
}

describe("Better Auth 构建期边界", () => {
  it.each([authRuntimeEntrypoint, authRouteEntrypoint])(
    "在没有认证或数据库环境变量时可以导入 %s",
    async (entrypoint) => {
      const { stderr, stdout } = await execFileAsync(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", entrypoint],
        { env: environmentWithoutAuthRuntimeConfiguration() },
      );

      expect(stdout).toBe("");
      expect(stderr).toBe("");
    },
  );
});
