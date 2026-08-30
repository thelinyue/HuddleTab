import { NextResponse } from "next/server";
import { z } from "zod";

import { ApplicationError } from "@/server/errors/application-error";

export const dynamic = "force-dynamic";

/** 邀请查询和写入都强制动态执行，避免 PWA 或 CDN 缓存活动成员权限结果。 */
const linkInput = z.object({ replaceExisting: z.boolean() }).strict();

export async function GET(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { InvitationService },
    { sql },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/services/invitation-service"),
    import("@/server/db/client"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const data = await new InvitationService(sql).getLinkStatus({
      session: { user: { id: sessionUserId(session) } },
      activityId: params.activityId,
    });
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

/**
 * 邀请明文只在创建或显式重置时返回一次；数据库继续只保存 Hash。打开邀请中心
 * 仅调用 GET，不会意外让已经分享出去的旧链接失效。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  return updateInvitation(request, context, "create");
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  return updateInvitation(request, context, "disable");
}

async function updateInvitation(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
  operation: "create" | "disable",
) {
  const [
    { requireSession, sessionUserId },
    { InvitationService },
    { sql },
    { MaintenanceMode },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/services/invitation-service"),
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
    const service = new InvitationService(sql);
    const input = {
      session: { user: { id: sessionUserId(session) } },
      activityId: params.activityId,
    };
    if (operation === "disable") {
      await service.disableLink(input);
      return NextResponse.json({ data: { disabled: true } });
    }
    let body: unknown;
    const rawBody = await request.text();
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      throw new ApplicationError(
        "INVALID_REQUEST",
        "邀请链接请求格式无效。",
        400,
      );
    }
    const parsed = linkInput.safeParse(body);
    if (!parsed.success) {
      throw new ApplicationError(
        "INVALID_REQUEST",
        "邀请链接请求参数无效。",
        400,
      );
    }
    const { replaceExisting } = parsed.data;
    const raw = await service.createLink({ ...input, replaceExisting });
    return NextResponse.json(
      { data: { invitePath: `/join/${encodeURIComponent(raw)}` } },
      { status: 201 },
    );
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
