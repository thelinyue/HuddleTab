import { z } from "zod";

export const dynamic = "force-dynamic";

const roleInput = z.object({ granted: z.boolean() });

/** 系统角色写入仅接受显式布尔命令，授予人与最后管理员不变量均交由服务层处理。 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const [
    { requireSession },
    { sql },
    { requireSystemAdmin },
    { SystemAdminService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/permissions/require-system-admin"),
    import("@/server/services/system-admin-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const grantedByUserId = await requireSystemAdmin(sql, session);
    const input = roleInput.parse(await request.json());
    const service = new SystemAdminService(sql);
    if (input.granted)
      await service.grantSystemAdmin(params.userId, grantedByUserId);
    else await service.revokeSystemAdmin(params.userId);
    return Response.json({
      data: { userId: params.userId, granted: input.granted },
    });
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
        message: "管理员请求不合法，请检查后重试。",
        fieldErrors: error.flatten().fieldErrors,
        details: {},
      },
    },
    { status: 422 },
  );
}
