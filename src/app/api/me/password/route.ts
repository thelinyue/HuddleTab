import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
const passwordInput = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
  revokeOtherSessions: z.boolean().optional(),
});

export async function POST(request: Request) {
  const [{ requireSession }, { auth }] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/auth/auth"),
  ]);
  await requireSession(request.headers);
  await auth.api.changePassword({
    headers: request.headers,
    body: passwordInput.parse(await request.json()),
  });
  return NextResponse.json({ data: { changed: true } });
}
