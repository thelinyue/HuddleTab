import { z } from "zod";

export const dynamic = "force-dynamic";

const smtpInput = z
  .object({
    enabled: z.boolean(),
    host: z.string().trim().max(255),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    username: z.string().max(255),
    password: z.string().max(1024),
  })
  .superRefine((value, context) => {
    if (value.enabled && (!value.host || !value.username || !value.password)) {
      context.addIssue({
        code: "custom",
        message: "启用 SMTP 时必须填写服务器、用户名和密码。",
      });
    }
  });

/** SMTP 查询只序列化安全视图，数据库密文与任何明文都不能越过服务边界。 */
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
      data: await new SystemSettingsService(sql).getSmtpView(),
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
    const input = smtpInput.parse(await request.json());
    const service = new SystemSettingsService(sql);
    await service.saveSmtp(input, actorUserId);
    return Response.json({ data: await service.getSmtpView() });
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
        message: "SMTP 配置不合法，请检查后重试。",
        fieldErrors: error.flatten().fieldErrors,
        details: {},
      },
    },
    { status: 422 },
  );
}
