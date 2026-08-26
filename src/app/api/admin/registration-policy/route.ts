import { z } from "zod";

export const dynamic = "force-dynamic";

const registrationPolicyInput = z.object({
  policy: z.enum(["INVITE_ONLY", "OPEN"]),
});

/** 注册策略是平台级配置，Activity 角色不能访问此接口。 */
export async function GET(request: Request) {
  const [
    { requireSession },
    { sql },
    { requireSystemAdmin },
    { SystemSettingsService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/permissions/require-system-admin"),
    import("@/server/services/system-settings-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const session = await requireSession(request.headers);
    await requireSystemAdmin(sql, session);
    return Response.json({
      data: {
        policy: await new SystemSettingsService(sql).getRegistrationPolicy(),
      },
    });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function PUT(request: Request) {
  const [
    { requireSession },
    { sql },
    { requireSystemAdmin },
    { SystemSettingsService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/permissions/require-system-admin"),
    import("@/server/services/system-settings-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const session = await requireSession(request.headers);
    const actorUserId = await requireSystemAdmin(sql, session);
    const input = registrationPolicyInput.parse(await request.json());
    await new SystemSettingsService(sql).setRegistrationPolicy(
      input.policy,
      actorUserId,
    );
    return Response.json({ data: { policy: input.policy } });
  } catch (error) {
    if (error instanceof z.ZodError) return validationError(error);
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

function validationError(error: z.ZodError) {
  return Response.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "注册策略请求不合法，请检查后重试。",
        fieldErrors: error.flatten().fieldErrors,
        details: {},
      },
    },
    { status: 422 },
  );
}
