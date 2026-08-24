import "server-only";

/**
 * Next.js 应用通过此入口取得数据库实例，避免客户端组件误导入数据库访问代码。
 * 迁移 CLI 与集成测试则直接使用 client.ts，以兼容裸 Node.js 运行时。
 */
export { db, sql } from "./client";