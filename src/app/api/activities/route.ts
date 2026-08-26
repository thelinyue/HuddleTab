import { requireSession } from "@/server/auth/session";
import { getDatabaseClient } from "@/server/db";
import { ApplicationError } from "@/server/errors/application-error";
import { ActivityService } from "@/server/services/activity-service";
import { createActivityInput } from "@/server/validation/activity";

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

/** 仅返回当前成员可见的未删除活动，明确列出字段以避免暴露认证账户资料。 */
export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request.headers);
    const data = await getDatabaseClient().sql`
      select
        activity.id,
        activity.name,
        activity.location,
        activity.base_currency as "baseCurrency",
        activity.start_date as "startDate",
        activity.end_date as "endDate",
        activity.status,
        activity.invite_mode as "inviteMode",
        activity.revision,
        activity.updated_at as "updatedAt"
      from activities activity
      join activity_members member on member.activity_id = activity.id
      where member.user_id = ${session.user.id}
        and activity.deleted_at is null
      order by activity.updated_at desc
    `;
    return Response.json({ data });
  } catch (error) {
    if (error instanceof ApplicationError) return errorResponse(error);
    throw error;
  }
}

/** 创建活动需要完整的用户资料昵称，首位 Owner 由事务化 ActivityService 原子建立。 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request.headers);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(
        new ApplicationError(
          "INVALID_ACTIVITY_INPUT",
          "活动信息格式不正确。",
          422,
        ),
      );
    }
    const parsed = createActivityInput.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        new ApplicationError(
          "INVALID_ACTIVITY_INPUT",
          "活动信息格式不正确。",
          422,
        ),
      );
    }

    const sql = getDatabaseClient().sql;
    const [profile] = await sql<{ nickname: string }[]>`
      select nickname from user_profiles where user_id = ${session.user.id}
    `;
    if (!profile) {
      return errorResponse(
        new ApplicationError(
          "USER_PROFILE_REQUIRED",
          "请先完善个人资料后再创建活动。",
          409,
        ),
      );
    }
    const data = await new ActivityService(sql).create({
      ...parsed.data,
      ownerUserId: session.user.id,
      ownerDisplayName: profile.nickname,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ApplicationError) return errorResponse(error);
    throw error;
  }
}
