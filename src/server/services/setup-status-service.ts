import "server-only";

import { sql } from "@/server/db/client";

/**
 * 首次初始化只由完成时间决定：管理员创建成功后写入 completed_at，之后所有进程和
 * 页面请求都会得到一致的已初始化结果。这里集中读取，避免 Proxy 与 API 出现不同判定。
 */
export async function isSetupRequired(): Promise<boolean> {
  const [bootstrap] =
    await sql`select completed_at from system_bootstrap where id = 'singleton'`;
  return !bootstrap?.completed_at;
}
