import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { initializeSetup } from "./initialize-setup";

type ContainerExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};
type SpawnProcess = typeof spawn;

/** 将 Docker 的终止信号转交给 Next 子进程，避免 PID 1 吞掉优雅停机请求。 */
async function launchContainer(
  initialize: () => Promise<void>,
  spawnProcess: SpawnProcess,
): Promise<ContainerExit> {
  await initialize();
  const child = spawnProcess(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "5660"],
    { stdio: "inherit", env: process.env },
  );
  const forwardSignal = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  const signalHandlers = signals.map(
    (signal) => [signal, () => forwardSignal(signal)] as const,
  );
  for (const [signal, handler] of signalHandlers) {
    process.once(signal, handler);
  }

  return new Promise<ContainerExit>((resolve, reject) => {
    const cleanup = () => {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolve({ code, signal });
    });
  });
}

/** 供单测复用的启动边界：初始化完成后才启动 Next，并将普通退出码原样返回。 */
export async function startContainer(
  initialize: () => Promise<void> = initializeSetup,
  spawnProcess: SpawnProcess = spawn,
): Promise<number> {
  const result = await launchContainer(initialize, spawnProcess);
  return result.code ?? 1;
}

const executedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (executedDirectly) {
  try {
    const result = await launchContainer(initializeSetup, spawn);
    if (result.signal) {
      process.kill(process.pid, result.signal);
    } else {
      process.exitCode = result.code ?? 1;
    }
  } catch {
    console.error(
      "容器启动失败（CONTAINER_START_FAILED），请检查初始化日志和运行配置。",
    );
    process.exitCode = 1;
  }
}
