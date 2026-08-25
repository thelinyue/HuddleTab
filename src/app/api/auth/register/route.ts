import { ApplicationError } from "@/server/errors/application-error";
import { normalizeUsername } from "@/server/auth/username";
import { readAuthSecret } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/db";
import { getClientAddress } from "@/server/security/client-address";
import {
  RateLimiter,
  type RateLimitBucket,
} from "@/server/security/rate-limiter";
import { RegistrationService } from "@/server/services/registration-service";
import { registerInput } from "@/server/validation/auth";

const rejectingInvitationVerifier = {
  verify: async () => false,
};

/** 当前路由的预期业务错误统一保持 V1 固定错误信封，避免客户端按端点分支解析。 */
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

function invalidInputResponse(): Response {
  return errorResponse("INVALID_REGISTER_INPUT", "注册信息格式不正确。", 422);
}

/**
 * 完整 schema 校验前只能使用已成功规范化的用户名作为稳定标识；无法提取时保留原有
 * 422 行为且不创建 bucket，避免为缺失、非字符串或非法用户名制造无意义的共享计数器。
 */
function getRateLimitUsername(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("username" in body)) {
    return undefined;
  }

  try {
    return normalizeUsername(body.username);
  } catch {
    return undefined;
  }
}

/**
 * 在任何凭据创建前消费规范化用户名；可信代理模式下额外消费 IP bucket，但 IP 绝不
 * 代替稳定业务标识。RateLimiter 只接收 HMAC secret，不会持久化这些原始值。
 */
async function consumeRegistrationRateLimit(
  request: Request,
  normalizedUsername: string,
): Promise<void> {
  const buckets: RateLimitBucket[] = [
    { scope: "REGISTER_USERNAME", identifier: normalizedUsername },
  ];
  const clientAddress = getClientAddress(request);
  if (clientAddress) {
    buckets.push({ scope: "REGISTER_IP", identifier: clientAddress });
  }

  await new RateLimiter(getDatabaseClient().sql, readAuthSecret()).consumeAll(
    buckets,
  );
}

/**
 * 产品注册入口负责把预期的校验与业务错误转换为稳定 JSON；密码、邀请码和内部邮箱
 * 均不会写入响应或日志。认证用户的创建与补偿由 RegistrationService 集中处理。
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidInputResponse();
  }

  try {
    const username = getRateLimitUsername(body);
    if (username) {
      await consumeRegistrationRateLimit(request, username);
    }

    const parsed = registerInput.safeParse(body);
    if (!parsed.success) {
      return invalidInputResponse();
    }

    const result = await new RegistrationService(
      rejectingInvitationVerifier,
    ).register(parsed.data);
    const response = Response.json({ data: result.user }, { status: 201 });

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
