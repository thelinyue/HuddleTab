import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
const profileInput = z.object({
  nickname: z.string().trim().min(1).max(40),
  avatarPreset: z
    .union(
      [
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
      ],
      { error: "头像预设仅支持 1 至 6。" },
    )
    .optional(),
});

function routeErrorResponse(
  error: unknown,
  applicationErrorResponse: (error: unknown) => Response | undefined,
) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "个人资料请求不合法，请检查后重试。",
          fieldErrors: error.flatten().fieldErrors,
          details: {},
        },
      },
      { status: 422 },
    );
  }
  return applicationErrorResponse(error);
}

export async function GET(request: Request) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { MeService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/me-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const userId = sessionUserId(await requireSession(request.headers));
    return NextResponse.json({
      data: await new MeService(sql).getProfile(userId),
    });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function PATCH(request: Request) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { MeService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/me-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const userId = sessionUserId(await requireSession(request.headers));
    const input = profileInput.parse(await request.json());
    await new MeService(sql).updateProfile(userId, input);
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = routeErrorResponse(error, applicationErrorResponse);
    if (response) return response;
    throw error;
  }
}
