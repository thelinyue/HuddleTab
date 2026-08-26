import { NextResponse } from "next/server";
import { z } from "zod";

import { serializeSettlement } from "@/server/http/settlement-response";
import { createSettlementInput } from "@/server/validation/settlement";

export const dynamic = "force-dynamic";

function errorResponse(
  error: unknown,
  applicationErrorResponse: (error: unknown) => Response | undefined,
) {
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "请求数据不合法，请检查后重试。",
          fieldErrors: error.flatten().fieldErrors,
          details: {},
        },
      },
      { status: 422 },
    );
  return applicationErrorResponse(error);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { SettlementService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/settlement-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const data = await new SettlementService(sql).list(
      { user: { id: sessionUserId(session) } },
      params.activityId,
    );
    return NextResponse.json({ data: data.map(serializeSettlement) });
  } catch (error) {
    const response = errorResponse(error, applicationErrorResponse);
    if (response) return response;
    throw error;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { SettlementService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/settlement-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session, input] = await Promise.all([
      context.params,
      requireSession(request.headers),
      createSettlementInput.parseAsync(await request.json()),
    ]);
    const result = await new SettlementService(sql).create(
      { user: { id: sessionUserId(session) } },
      params.activityId,
      input,
    );
    return NextResponse.json(
      { data: { settlement: serializeSettlement(result.settlement) } },
      { status: 201 },
    );
  } catch (error) {
    const response = errorResponse(error, applicationErrorResponse);
    if (response) return response;
    throw error;
  }
}
