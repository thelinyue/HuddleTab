export const dynamic = "force-dynamic";

/** dataDirectory 是部署环境信息，必须在平台管理员守卫成功后才可序列化。 */
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
      data: await new SystemInformationService(
        new SystemProbe(sql),
      ).information(),
    });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
