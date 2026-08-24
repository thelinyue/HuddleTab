import { getDatabaseClient } from "@/server/db";
import {
  compensateSetupCredentialUser,
  createSetupCredentialUser,
} from "@/server/services/registration-service";
import { SetupService } from "@/server/services/setup-service";

type SetupLogger = (message: string, token: string) => void;

/**
 * 仅容器启动路径会调用此函数。未初始化时 token 只由这里的单条安全警告输出；普通 API、
 * 错误处理和其他日志路径均不会接触 token 明文。
 */
export async function initializeSetup(
  log: SetupLogger = console.warn,
): Promise<void> {
  const service = new SetupService(getDatabaseClient().sql, {
    create: createSetupCredentialUser,
    compensate: compensateSetupCredentialUser,
  });
  const token = await service.rotateForUninitializedStartup();

  if (token) {
    log(
      "系统尚未初始化（SETUP_TOKEN_CREATED）。Setup Token 仅在本次容器启动输出一次，请仅由部署管理员查看：%s",
      token,
    );
  }
}
