import { sql } from "../db/client";
import { startOrphanAttachmentCleanup } from "../jobs/orphan-attachment-cleanup";

/**
 * Next.js 自己负责监听 5660 端口；首次管理员改由页面创建，不再在容器日志生成敏感口令。
 * 此函数只能从 instrumentation 运行时调用，避免绕过 Next.js 的服务端边界。
 */
export async function initializeContainerRuntime(): Promise<void> {
  startOrphanAttachmentCleanup(sql);
}
