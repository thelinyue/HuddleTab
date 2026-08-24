import { ApplicationError } from "@/server/errors/application-error";
import { RegistrationService } from "@/server/services/registration-service";
import { registerInput } from "@/server/validation/auth";

/** Phase 2 尚未接入邀请模块，因此默认验证器始终拒绝 INVITE_ONLY 注册。 */
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

  const parsed = registerInput.safeParse(body);
  if (!parsed.success) {
    return invalidInputResponse();
  }

  try {
    const data = await new RegistrationService(
      rejectingInvitationVerifier,
    ).register(parsed.data);
    return Response.json({ data }, { status: 201 });
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
