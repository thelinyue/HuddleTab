import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/** 数据库配置错误只保留稳定中文说明，避免连接串中的敏感信息进入日志。 */
export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

/**
 * 创建 postgres.js 与 Drizzle 客户端前，先用标准 URL 解析器校验连接串。
 *
 * 此函数故意不把原始连接串放入异常：连接串通常含用户名和密码，配置错误会写入
 * 部署日志或健康检查链路，泄露这些信息比提供底层解析细节更危险。
 */
function validateConnectionString(
  connectionString: string | undefined,
): string {
  if (!connectionString?.trim()) {
    throw new DatabaseConfigurationError(
      "数据库连接配置无效：DATABASE_URL 不能为空",
    );
  }

  try {
    const url = new URL(connectionString);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new DatabaseConfigurationError(
      "数据库连接配置无效：DATABASE_URL 必须是 postgres:// 或 postgresql:// 连接串",
    );
  }

  return connectionString;
}

/**
 * 供迁移 CLI、集成测试和服务端运行时共用的纯数据库工厂。
 * 它不读取环境变量、不缓存全局实例，也不引入 server-only，因而可在裸 Node.js 中使用。
 */
export function createDatabaseClient(
  connectionString: string | undefined,
  max = 10,
) {
  const validatedConnectionString = validateConnectionString(connectionString);

  const sql = postgres(validatedConnectionString, { max });
  return { sql, db: drizzle(sql) };
}
