import { NextResponse } from "next/server";
import { z } from "zod";

import { serializeExpense } from "@/server/http/expense-response";
import {
  createExpenseInput,
  listExpenseInput,
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

/** Expense 列表只支持名称、固定分类和“我参与的”三种冻结筛选条件。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
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
    const query = listExpenseInput.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const data = await new ExpenseService(sql).list(
      { user: { id: sessionUserId(session) } },
      params.activityId,
      query,
    );
    return NextResponse.json({ data: data.map(serializeExpense) });
  } catch (error) {
    const response = routeErrorResponse(error, applicationErrorResponse);
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
    const input = await createExpenseInput.parseAsync(await request.json());
    const result = await new ExpenseService(sql).create(
      { user: { id: sessionUserId(session) } },
      params.activityId,
      input,
    );
    return NextResponse.json(
      {
        data: {
          expense: serializeExpense(result.expense),
          idempotentReplay: result.idempotentReplay,
        },
      },
      { status: result.idempotentReplay ? 200 : 201 },
    );
  } catch (error) {
    const response = routeErrorResponse(error, applicationErrorResponse);
    if (response) return response;
    throw error;
  }
}
