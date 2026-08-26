import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { getDatabaseClient } from "@/server/db";
import { ApplicationError } from "@/server/errors/application-error";
import { authorizeActivityOperation } from "@/server/permissions/authorize-activity-operation";
import { InvitationService } from "@/server/services/invitation-service";

const decisionInput = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  displayName: z.string().trim().min(1).max(80),
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

/** 管理者在事务内通过固定 Task 2 授权后，才可转交审批服务处理加入申请。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ activityId: string; requestId: string }> },
): Promise<Response> {
  try {
    const session = await requireSession(request.headers);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(
        new ApplicationError(
          "INVALID_JOIN_REQUEST_DECISION",
          "加入申请处理信息格式不正确。",
          422,
        ),
      );
    }
    const parsed = decisionInput.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        new ApplicationError(
          "INVALID_JOIN_REQUEST_DECISION",
          "加入申请处理信息格式不正确。",
          422,
        ),
      );
    }

    const { activityId, requestId } = await context.params;
    const sql = getDatabaseClient().sql;
    await sql.begin(async (transaction) => {
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "MEMBER_MANAGE",
      });
      await new InvitationService(transaction).decideJoinRequest(
        requestId,
        authorization.member.id,
        parsed.data.decision,
        parsed.data.displayName,
      );
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApplicationError) return errorResponse(error);
    throw error;
  }
}
