import { requireSession } from "@/server/auth/session";
import { getDatabaseClient } from "@/server/db";
import { ApplicationError } from "@/server/errors/application-error";
import { authorizeActivityOperation } from "@/server/permissions/authorize-activity-operation";
import {
  ActivityLifecycleService,
  type LifecycleAction,
} from "@/server/services/activity-lifecycle-service";

const operationByAction: Record<
  LifecycleAction,
  Parameters<typeof authorizeActivityOperation>[1]["operation"]
> = {
  END: "ACTIVITY_END",
  REOPEN: "ACTIVITY_REOPEN",
  ARCHIVE: "ACTIVITY_ARCHIVE",
  UNARCHIVE: "ACTIVITY_UNARCHIVE",
  DELETE: "ACTIVITY_DELETE",
  RESTORE: "ACTIVITY_RESTORE",
};

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

/** 每条生命周期路由只声明固定动作；授权、写入和复核始终复用同一事务。 */
export function makeLifecycleRoute(action: LifecycleAction) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ activityId: string }> },
  ): Promise<Response> {
    try {
      const session = await requireSession(request.headers);
      const { activityId } = await context.params;
      const sql = getDatabaseClient().sql;
      await sql.begin(async (transaction) => {
        const authorization = await authorizeActivityOperation(transaction, {
          session,
          activityId,
          operation: operationByAction[action],
        });
        await new ActivityLifecycleService(transaction).transition(
          activityId,
          authorization.member.id,
          action,
        );
      });
      return Response.json({ data: { action } });
    } catch (error) {
      if (error instanceof ApplicationError) return errorResponse(error);
      throw error;
    }
  };
}
