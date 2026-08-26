import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
const nicknameInput = z.object({ nickname: z.string().trim().min(1).max(40) });

export async function GET(request: Request) {
  const [{ requireSession, sessionUserId }, { sql }, { MeService }] =
    await Promise.all([
      import("@/server/auth/session"),
      import("@/server/db/client"),
      import("@/server/services/me-service"),
    ]);
  const userId = sessionUserId(await requireSession(request.headers));
  return NextResponse.json({
    data: await new MeService(sql).getProfile(userId),
  });
}

export async function PATCH(request: Request) {
  const [{ requireSession, sessionUserId }, { sql }, { MeService }] =
    await Promise.all([
      import("@/server/auth/session"),
      import("@/server/db/client"),
      import("@/server/services/me-service"),
    ]);
  const userId = sessionUserId(await requireSession(request.headers));
  const input = nicknameInput.parse(await request.json());
  await new MeService(sql).updateNickname(userId, input.nickname);
  return new Response(null, { status: 204 });
}
