import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { getDatabaseClient } from "@/server/db";
import { ApplicationError } from "@/server/errors/application-error";
import { ProfileEmailService } from "@/server/services/profile-email-service";
import { MeService } from "@/server/services/me-service";

const emailInput = z.object({ email: z.string() });

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

/** 邮箱读取始终按 profile 的 email_kind 脱敏，而不是信任 Better Auth user.email。 */
export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request.headers);
    const data = await new MeService(getDatabaseClient().sql).getEmail(
      session.user.id,
    );
    return Response.json({ data });
  } catch (error) {
    if (error instanceof ApplicationError) return errorResponse(error);
    throw error;
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request.headers);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(
        new ApplicationError(
          "INVALID_REAL_EMAIL",
          "请输入可接收邮件的真实邮箱地址。",
          422,
        ),
      );
    }

    const parsed = emailInput.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        new ApplicationError(
          "INVALID_REAL_EMAIL",
          "请输入可接收邮件的真实邮箱地址。",
          422,
        ),
      );
    }

    await new ProfileEmailService(getDatabaseClient().sql).bindRealEmail(
      session.user.id,
      parsed.data.email,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApplicationError) return errorResponse(error);
    throw error;
  }
}
