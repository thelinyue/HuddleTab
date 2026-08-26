export const dynamic = "force-dynamic";

/** 存储统计只在完成 Session 与平台管理员检查后执行，绝不读取活动数据。 */
export async function GET(request: Request) {
  const [
    { requireSession },
    { sql },
    { requireSystemAdmin },
    { SystemInformationService, SystemProbe },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/permissions/require-system-admin"),
    import("@/server/services/system-information-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const session = await requireSession(request.headers);
    await requireSystemAdmin(sql, session);
    return Response.json({
      data: await new SystemInformationService(new SystemProbe(sql)).storage(),
    });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
