import { z } from "zod";

export const dynamic = "force-dynamic";

const testMailInput = z.object({
  recipient: z
    .string()
    .email("请填写有效的测试收件人地址。")
    .refine(
      (email) => !email.toLowerCase().endsWith("@local.invalid"),
      "测试邮件必须发送到真实收件人地址。",
    ),
});

/** 测试接口要求管理员明确输入真实地址，响应不回显地址或 SMTP 连接细节。 */
export async function POST(request: Request) {
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
    const input = testMailInput.parse(await request.json());
    await new SystemSettingsService(sql).sendTestMail(input.recipient);
    return Response.json({ data: { sent: true } });
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
        message: "测试邮件请求不合法，请检查收件人地址。",
        fieldErrors: error.flatten().fieldErrors,
        details: {},
      },
    },
    { status: 422 },
  );
}
