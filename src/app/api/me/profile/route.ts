import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { getDatabaseClient } from "@/server/db";
import { ApplicationError } from "@/server/errors/application-error";
import { MeService } from "@/server/services/me-service";

const nicknameInput = z.object({
  nickname: z.string().trim().min(1).max(40),
});

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

/** 已登录用户只能读取和更新自身的产品资料，绝不读取认证 user.email。 */
export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request.headers);
    const data = await new MeService(getDatabaseClient().sql).getProfile(
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
        new ApplicationError("INVALID_NICKNAME", "昵称格式不正确。", 422),
      );
    }

    const parsed = nicknameInput.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        new ApplicationError(
          "INVALID_NICKNAME",
          "昵称长度必须为 1 到 40 个字符。",
          422,
        ),
      );
    }

    await new MeService(getDatabaseClient().sql).updateNickname(
      session.user.id,
      parsed.data.nickname,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApplicationError) return errorResponse(error);
    throw error;
  }
}
