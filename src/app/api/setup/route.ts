import { readAuthSecret } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/db";
import { ApplicationError } from "@/server/errors/application-error";
import { getClientAddress } from "@/server/security/client-address";
import {
  RateLimiter,
  type RateLimitBucket,
} from "@/server/security/rate-limiter";
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

/** 仅将 JSON 中实际存在的字符串 Token 作为完整 schema 校验前的稳定限流标识。 */
function getRateLimitSetupToken(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("setupToken" in body)) {
    return undefined;
  }

  const parsed = setupInput.shape.setupToken.safeParse(body.setupToken);
  return parsed.success ? parsed.data : undefined;
}

/** 在验证 Setup Token 前先消费其 bucket，防止攻击者枚举或暴力抢占首次初始化。 */
async function consumeSetupRateLimit(
  request: Request,
  setupToken: string,
): Promise<void> {
  const buckets: RateLimitBucket[] = [
    { scope: "SETUP_TOKEN", identifier: setupToken },
  ];
  const clientAddress = getClientAddress(request);
  if (clientAddress) {
    buckets.push({ scope: "SETUP_IP", identifier: clientAddress });
  }

  await new RateLimiter(getDatabaseClient().sql, readAuthSecret()).consumeAll(
    buckets,
  );
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

  try {
    const setupToken = getRateLimitSetupToken(body);
    if (setupToken !== undefined) {
      await consumeSetupRateLimit(request, setupToken);
    }

    const parsed = setupInput.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "INVALID_SETUP_INPUT",
        "初始化信息格式不正确。",
        422,
      );
    }

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
