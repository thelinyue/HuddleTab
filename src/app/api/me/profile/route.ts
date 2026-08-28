import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
const profileInput = z.object({
  nickname: z.string().trim().min(1).max(40),
  avatarPreset: z
    .union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ])
    .optional(),
});

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
  const input = profileInput.parse(await request.json());
  await new MeService(sql).updateProfile(userId, input);
  return new Response(null, { status: 204 });
}
