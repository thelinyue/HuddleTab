import { NextResponse } from "next/server";

import { createActivityInput } from "@/server/validation/activity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const session = await requireSession(request.headers);
    const data =
      await sql`select activity.* from activities activity join activity_members member on member.activity_id = activity.id
        where member.user_id = ${sessionUserId(session)} and activity.deleted_at is null order by activity.updated_at desc`;
    return NextResponse.json({ data });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { ActivityService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/activity-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [session, body] = await Promise.all([
      requireSession(request.headers),
      createActivityInput.parseAsync(await request.json()),
    ]);
    const userId = sessionUserId(session);
    const [profile] =
      await sql`select nickname from user_profiles where user_id = ${userId}`;
    if (!profile) throw new Error("用户资料不存在，请重新登录后重试。");
    const data = await new ActivityService(sql).create({
      ...body,
      session: { user: { id: userId } },
      ownerDisplayName: profile.nickname,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
