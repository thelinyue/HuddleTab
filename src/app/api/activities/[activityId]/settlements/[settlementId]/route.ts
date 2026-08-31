import { NextResponse } from "next/server";
import { z } from "zod";

import { serializeSettlement } from "@/server/http/settlement-response";
import {
  deleteSettlementInput,
  updateSettlementInput,
} from "@/server/validation/settlement";

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

type ItemContext = {
  params: Promise<{ activityId: string; settlementId: string }>;
};

export async function PUT(request: Request, context: ItemContext) {
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
    const input = await updateSettlementInput.parseAsync(await request.json());
    const result = await new SettlementService(sql).update(
      { user: { id: sessionUserId(session) } },
      params.activityId,
      params.settlementId,
      input,
    );
    return NextResponse.json({
      data: { settlement: serializeSettlement(result.settlement) },
    });
  } catch (error) {
    const response = errorResponse(error, applicationErrorResponse);
    if (response) return response;
    throw error;
  }
}

export async function DELETE(request: Request, context: ItemContext) {
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
    const input = await deleteSettlementInput.parseAsync(await request.json());
    await new SettlementService(sql).remove(
      { user: { id: sessionUserId(session) } },
      params.activityId,
      params.settlementId,
      input.version,
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const response = errorResponse(error, applicationErrorResponse);
    if (response) return response;
    throw error;
  }
}
