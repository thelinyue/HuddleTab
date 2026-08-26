import { z } from "zod";

export const dynamic = "force-dynamic";

const statusInput = z.object({ disabled: z.boolean() });

/** 管理员用户状态接口始终先完成平台权限检查，再执行不可逆账号写入。 */
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
    await requireSystemAdmin(sql, session);
    const input = statusInput.parse(await request.json());
    const service = new SystemAdminService(sql);
    if (input.disabled) await service.disableUser(params.userId);
    else await service.enableUser(params.userId);
    return Response.json({
      data: { userId: params.userId, disabled: input.disabled },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return validationError(error);
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

/** 删除账号同样依赖服务事务的不变量，Route 绝不能自行绕过最后管理员校验。 */
export async function DELETE(
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
    await requireSystemAdmin(sql, session);
    await new SystemAdminService(sql).deleteUser(params.userId);
    return Response.json({ data: { userId: params.userId, deleted: true } });
  } catch (error) {
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
