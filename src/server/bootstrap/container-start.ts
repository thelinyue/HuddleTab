import { spawn } from "node:child_process";

import { initializeSetup } from "./initialize-setup";

/** 容器启动在迁移后先检查初始化状态，再以固定 5660 端口启动 Next.js。 */
async function startNext(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "-H",
        "0.0.0.0",
        "-p",
        "5660",
      ],
      { stdio: "inherit", env: process.env },
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Next.js 进程异常退出，退出码：${code ?? 1}`));
    });
  });
}

await initializeSetup();
await startNext();
