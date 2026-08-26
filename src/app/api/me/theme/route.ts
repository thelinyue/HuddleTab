import { z } from "zod";

export const dynamic = "force-dynamic";
const themeInput = z.object({ theme: z.enum(["SYSTEM", "LIGHT", "DARK"]) });

export async function PATCH(request: Request) {
  const [{ requireSession, sessionUserId }, { sql }, { MeService }] =
    await Promise.all([
      import("@/server/auth/session"),
      import("@/server/db/client"),
      import("@/server/services/me-service"),
    ]);
  const userId = sessionUserId(await requireSession(request.headers));
  await new MeService(sql).updateTheme(
    userId,
    themeInput.parse(await request.json()).theme,
  );
  return new Response(null, { status: 204 });
}
