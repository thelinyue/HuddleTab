import { getDatabaseClient } from "@/server/db";
import { ApplicationError } from "@/server/errors/application-error";
import {
  compensateSetupCredentialUser,
  createSetupCredentialUser,
} from "@/server/services/registration-service";
import { SetupService } from "@/server/services/setup-service";
import { setupInput } from "@/server/validation/auth";

/** Setup API 保持 V1 固定错误信封，不向客户端泄露 token、认证细节或数据库错误。 */
function errorResponse(
  code: string,
  message: string,
  status: number,
  details: Record<string, unknown> = {},
): Response {
  return Response.json(
    { error: { code, message, fieldErrors: {}, details } },
    { status },
  );
}

function createSetupService(): SetupService {
  return new SetupService(getDatabaseClient().sql, {
    create: createSetupCredentialUser,
    compensate: compensateSetupCredentialUser,
  });
}

export async function GET(): Promise<Response> {
  const setupRequired = await createSetupService().isSetupRequired();
  return Response.json({ data: { setupRequired } });
}

/** 成功后仅转发 Set-Cookie；JSON 绝不包含 token、邮箱或密码。 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_SETUP_INPUT", "初始化信息格式不正确。", 422);
  }

  const parsed = setupInput.safeParse(body);
  if (!parsed.success) {
    return errorResponse("INVALID_SETUP_INPUT", "初始化信息格式不正确。", 422);
  }

  try {
    const result = await createSetupService().claim(parsed.data.setupToken, {
      username: parsed.data.username,
      password: parsed.data.password,
      nickname: parsed.data.nickname,
    });
    const response = Response.json(
      { data: { initialized: true } },
      { status: 201 },
    );
    for (const setCookie of result.headers.getSetCookie()) {
      response.headers.append("set-cookie", setCookie);
    }
    return response;
  } catch (error) {
    if (error instanceof ApplicationError) {
      return errorResponse(
        error.code,
        error.message,
        error.status,
        error.details,
      );
    }
    throw error;
  }
}
