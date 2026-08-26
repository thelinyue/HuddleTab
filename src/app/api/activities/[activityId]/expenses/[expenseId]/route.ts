import { NextResponse } from "next/server";
import { z } from "zod";

import {
  serializeExpense,
  serializeExpensePayment,
  serializeExpenseShare,
} from "@/server/http/expense-response";
import {
  deleteExpenseInput,
  updateExpenseInput,
} from "@/server/validation/expense";

export const dynamic = "force-dynamic";

function routeErrorResponse(
  error: unknown,
  applicationErrorResponse: (error: unknown) => Response | undefined,
) {
  if (error instanceof z.ZodError) {
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
  }
  return applicationErrorResponse(error);
}

type ItemContext = {
  params: Promise<{ activityId: string; expenseId: string }>;
};

/** 详情读取完整不可变事实，Payment/Share 明细不由客户端重新计算。 */
export async function GET(request: Request, context: ItemContext) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { ExpenseService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/expense-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const data = await new ExpenseService(sql).get(
      { user: { id: sessionUserId(session) } },
      params.activityId,
      params.expenseId,
    );
    return NextResponse.json({
      data: {
        expense: serializeExpense(data.expense),
        payments: data.payments.map(serializeExpensePayment),
        shares: data.shares.map(serializeExpenseShare),
        attachments: data.attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.safe_filename,
          mimeType: attachment.mime_type,
          width: attachment.width,
          height: attachment.height,
          byteSize: String(attachment.byte_size),
          sha256: attachment.sha256,
          createdAt: attachment.created_at.toISOString(),
        })),
        permissions: data.permissions,
      },
    });
  } catch (error) {
    const response = routeErrorResponse(error, applicationErrorResponse);
    if (response) return response;
    throw error;
  }
}

export async function PUT(request: Request, context: ItemContext) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { MaintenanceMode },
    { ExpenseService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/maintenance/maintenance-mode"),
    import("@/server/services/expense-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    await new MaintenanceMode(sql).assertWritesAllowed();
    const input = await updateExpenseInput.parseAsync(await request.json());
    const data = await new ExpenseService(sql).update(
      { user: { id: sessionUserId(session) } },
      params.activityId,
      params.expenseId,
      input,
    );
    return NextResponse.json({ data: serializeExpense(data) });
  } catch (error) {
    const response = routeErrorResponse(error, applicationErrorResponse);
    if (response) return response;
    throw error;
  }
}

export async function DELETE(request: Request, context: ItemContext) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { MaintenanceMode },
    { ExpenseService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/maintenance/maintenance-mode"),
    import("@/server/services/expense-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    await new MaintenanceMode(sql).assertWritesAllowed();
    const input = await deleteExpenseInput.parseAsync(await request.json());
    await new ExpenseService(sql).remove(
      { user: { id: sessionUserId(session) } },
      params.activityId,
      params.expenseId,
      input.version,
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const response = routeErrorResponse(error, applicationErrorResponse);
    if (response) return response;
    throw error;
  }
}
