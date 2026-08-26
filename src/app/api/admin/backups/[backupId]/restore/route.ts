import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const confirmationInput = z.object({ confirmed: z.literal(true) });

type RouteContext = { params: Promise<{ backupId: string }> };

/** 恢复必须由系统管理员显式确认；Service 才是维护模式和恢复顺序的最终边界。 */
export async function POST(request: Request, context: RouteContext) {
  const [
    { requireSession },
    { sql },
    { requireSystemAdmin },
    { createDatabaseRestoreService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/permissions/require-system-admin"),
    import("@/server/backup/restore-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const session = await requireSession(request.headers);
    const actorUserId = await requireSystemAdmin(sql, session);
    confirmationInput.parse(await request.json());
    await createDatabaseRestoreService(sql).restore(
      (await context.params).backupId,
      actorUserId,
    );
    return NextResponse.json({ data: { restored: true } });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "请明确确认后再执行恢复操作。",
            fieldErrors: error.flatten().fieldErrors,
            details: {},
          },
        },
        { status: 422 },
      );
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
