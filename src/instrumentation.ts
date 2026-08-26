import { initializeContainerRuntime } from "@/server/bootstrap/container-start";

/**
 * Next.js Node 运行时的容器启动钩子。
 * 这里执行首次 Setup 检查和后台清理任务，确保 server-only 模块始终由 Next.js 加载。
 */
export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  await initializeContainerRuntime();
}
