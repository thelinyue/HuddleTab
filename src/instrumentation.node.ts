import { initializeContainerRuntime } from "@/server/bootstrap/container-start";

/**
 * 此模块只会由 Node.js runtime 条件加载。首次 Setup 检查和后台清理任务因此仍在
 * Next.js 服务端边界内执行，同时不会污染 Edge 或浏览器侧的模块图。
 */
export async function registerContainerInstrumentation(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  await initializeContainerRuntime();
}
