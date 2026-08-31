import { NextResponse } from "next/server";
import { z } from "zod";

import { updateActivityInput } from "@/server/validation/activity";

export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ readonly activityId: string }> };

function validationError(error: z.ZodError) {
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "活动资料格式不正确，请检查后重试。",
        fieldErrors: error.flatten().fieldErrors,
        details: {},
      },
    },
    { status: 422 },
  );
}

export async function GET(request: Request, context: Context) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { ActivityDetailsService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/activity-details-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const data = await new ActivityDetailsService(sql).get(
      { user: { id: sessionUserId(session) } },
      params.activityId,
    );
    return NextResponse.json({ data });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function PATCH(request: Request, context: Context) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { ActivityDetailsService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/activity-details-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session, input] = await Promise.all([
      context.params,
      requireSession(request.headers),
      request.json().then((body) => updateActivityInput.parseAsync(body)),
    ]);
    const result = await new ActivityDetailsService(sql).update(
      { user: { id: sessionUserId(session) } },
      params.activityId,
      input,
    );
    return NextResponse.json({
      data: result.activity,
      ...(result.warnings.length ? { warnings: result.warnings } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return validationError(error);
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
