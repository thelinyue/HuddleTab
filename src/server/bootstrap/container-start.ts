import { initializeSetup } from "./initialize-setup";
import { sql } from "../db/client";
import { startOrphanAttachmentCleanup } from "../jobs/orphan-attachment-cleanup";

interface ContainerStartDependencies {
  initializeSetup(): Promise<void>;
  startNext(): Promise<void>;
}

/**
 * 生产启动只编排迁移后的初始化检查与 Next.js 启动。
 * Setup Token 的生成、Hash 替换和一次性中文日志仍由 Phase 2 initializeSetup() 唯一负责。
 */
export async function prepareContainerStart(
  dependencies: ContainerStartDependencies,
): Promise<void> {
  await dependencies.initializeSetup();
  await dependencies.startNext();
}

/**
 * Next.js 自己负责监听 5660 端口；此函数只能从 instrumentation 运行时调用，
 * 避免使用 tsx 直接加载 server-only 模块而绕过 Next.js 的服务端边界。
 */
export async function initializeContainerRuntime(): Promise<void> {
  await prepareContainerStart({
    initializeSetup,
    async startNext() {
      startOrphanAttachmentCleanup(sql);
    },
  });
}
