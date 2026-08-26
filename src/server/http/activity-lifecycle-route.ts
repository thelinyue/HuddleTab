import { NextResponse } from "next/server";

import type { LifecycleAction } from "@/server/services/activity-lifecycle-service";

/** 各生命周期 Route 只提供字面量动作，避免 HTTP 层重写授权或状态机。 */
export function makeLifecycleRoute(action: LifecycleAction) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ activityId: string }> },
  ) {
    const [
      { requireSession, sessionUserId },
      { ActivityLifecycleService },
      { sql },
      { MaintenanceMode },
      { applicationErrorResponse },
    ] = await Promise.all([
      import("@/server/auth/session"),
      import("@/server/services/activity-lifecycle-service"),
      import("@/server/db/client"),
      import("@/server/maintenance/maintenance-mode"),
      import("@/server/http/application-error-response"),
    ]);
    try {
      const [params, session] = await Promise.all([
        context.params,
        requireSession(request.headers),
      ]);
      await new MaintenanceMode(sql).assertWritesAllowed();
      await new ActivityLifecycleService(sql).transition({
        session: { user: { id: sessionUserId(session) } },
        activityId: params.activityId,
        action,
      });
      return NextResponse.json({ data: { action } });
    } catch (error) {
      const response = applicationErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };
}
