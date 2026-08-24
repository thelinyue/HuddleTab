import { ApplicationError } from "@/server/errors/application-error";
import { RegistrationService } from "@/server/services/registration-service";
import { registerInput } from "@/server/validation/auth";

/** Phase 2 尚未接入邀请模块，因此默认验证器始终拒绝 INVITE_ONLY 注册。 */
const rejectingInvitationVerifier = {
  verify: async () => false,
};

function invalidInputResponse(): Response {
  return Response.json(
    {
      error: {
        code: "INVALID_REGISTER_INPUT",
        message: "注册信息格式不正确。",
      },
    },
    { status: 422 },
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
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }

    throw error;
  }
}
