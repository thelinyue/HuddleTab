import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
const emailInput = z.object({ email: z.string().email() });

export async function POST(request: Request) {
  const [{ requireSession, sessionUserId }, { sql }, { ProfileEmailService }] =
    await Promise.all([
      import("@/server/auth/session"),
      import("@/server/db/client"),
      import("@/server/services/profile-email-service"),
    ]);
  const userId = sessionUserId(await requireSession(request.headers));
  await new ProfileEmailService(sql).bindRealEmail(
    userId,
    emailInput.parse(await request.json()).email,
  );
  return NextResponse.json({ data: { emailBound: true } });
}
