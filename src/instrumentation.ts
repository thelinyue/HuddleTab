/**
 * 根 instrumentation 不能静态导入 Node 专用模块：Next.js 也会为非 Node 运行时分析本文件。
 * 仅在 Node 生产运行时加载专用入口，避免 server-only 与 node:crypto 进入错误的编译目标。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerContainerInstrumentation } =
      await import("./instrumentation.node");
    await registerContainerInstrumentation();
  }
}
