import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const entrypointPath = resolve("docker-entrypoint.sh");

/** 从正式入口脚本提取自动连接串构造代码，避免测试复制一份可能漂移的实现。 */
async function readDatabaseUrlBuilder() {
  const entrypoint = await readFile(entrypointPath, "utf8");
  const startMarker = "DATABASE_URL=\"$(node -e '\n";
  const endMarker = "\n  ')\"";
  const start = entrypoint.indexOf(startMarker);
  const end = entrypoint.indexOf(endMarker, start + startMarker.length);

  if (start === -1 || end === -1) {
    throw new Error("无法从 Docker 入口脚本定位数据库连接串构造代码");
  }

  return {
    entrypoint,
    source: entrypoint.slice(start + startMarker.length, end),
  };
}

/** 用锁定版本 postgres.js 的公开解析结果检查最终传给服务端的原始配置值。 */
async function parseGeneratedDatabaseOptions(overrides: {
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
}) {
  const { source } = await readDatabaseUrlBuilder();
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["-e", source],
    {
      env: {
        ...process.env,
        POSTGRES_HOST: "postgres",
        POSTGRES_PORT: "5432",
        ...overrides,
      },
    },
  );

  expect(stderr).toBe("");

  const sql = postgres(stdout, { max: 1 });
  try {
    return {
      user: sql.options.user,
      password: sql.options.pass,
      database: sql.options.connection.database ?? sql.options.database,
    };
  } finally {
    await sql.end({ timeout: 0 });
  }
}

describe("Docker entrypoint database URL", () => {
  it.each([
    {
      name: "保留用户名和密码中的字面百分号",
      user: "u%2Fname",
      password: "p%40ss%word",
      database: "huddletab",
    },
    {
      name: "保留数据库名中的 URL 特殊字符",
      user: "huddletab",
      password: "local-password",
      database: "db name?x#y%z",
    },
    {
      name: "继续支持既有特殊字符密码",
      user: "u:name@host/path?x#y%z",
      password: "pa:ss@w/rd?&=+",
      database: "huddletab",
    },
  ])("$name", async ({ user, password, database }) => {
    const actual = await parseGeneratedDatabaseOptions({
      POSTGRES_USER: user,
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: database,
    });

    // 失败信息只暴露布尔结果，避免用户名、密码或连接串进入测试输出。
    expect(actual.user === user).toBe(true);
    expect(actual.password === password).toBe(true);
    expect(actual.database === database).toBe(true);
  });

  it("显式 DATABASE_URL 会绕过自动构造块", async () => {
    const { entrypoint } = await readDatabaseUrlBuilder();
    const conditionStart = entrypoint.indexOf(
      'if [ -z "${DATABASE_URL:-}" ]; then',
    );
    const builderStart = entrypoint.indexOf("DATABASE_URL=\"$(node -e '");
    const conditionEnd = entrypoint.indexOf("\nfi", builderStart);

    expect(conditionStart >= 0).toBe(true);
    expect(conditionStart < builderStart).toBe(true);
    expect(builderStart < conditionEnd).toBe(true);
  });
});
