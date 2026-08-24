import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { getDatabaseClient } from "@/server/db";
import { ApplicationError } from "@/server/errors/application-error";
import { MeService } from "@/server/services/me-service";

const themeInput = z.object({ theme: z.enum(["SYSTEM", "LIGHT", "DARK"]) });

function errorResponse(error: ApplicationError): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        fieldErrors: {},
        details: error.details,
      },
    },
    { status: error.status },
  );
}

/** 主题偏好是产品资料字段，只允许已登录用户修改自己的枚举值。 */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request.headers);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(
        new ApplicationError(
          "INVALID_THEME",
          "主题偏好必须为 SYSTEM、LIGHT 或 DARK。",
          422,
        ),
      );
    }

    const parsed = themeInput.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        new ApplicationError(
          "INVALID_THEME",
          "主题偏好必须为 SYSTEM、LIGHT 或 DARK。",
          422,
        ),
      );
    }

    await new MeService(getDatabaseClient().sql).updateTheme(
      session.user.id,
      parsed.data.theme,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApplicationError) return errorResponse(error);
    throw error;
  }
}
