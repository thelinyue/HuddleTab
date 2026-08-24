import "server-only";

/**
 * Next.js 服务端代码只能经此入口获取运行时数据库客户端。
 * 纯工厂位于 factory.ts，供迁移 CLI 和 Testcontainers 测试在普通 Node.js 环境中调用。
 */
export { getDatabaseClient } from "./client";
