import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const setupInput = z.object({
  setupToken: z.string().min(20),
  username: z.string(),
  password: z.string().min(8).max(128),
  nickname: z.string().trim().min(1).max(40),
});

export async function GET() {
  const { sql } = await import("@/server/db/client");
  const [bootstrap] =
    await sql`select completed_at from system_bootstrap where id = 'singleton'`;

  return NextResponse.json({
    data: { setupRequired: !bootstrap?.completed_at },
  });
}

export async function POST(request: Request) {
  const [{ createSetupService }, { normalizeUsername }] = await Promise.all([
    import("@/server/bootstrap/initialize-setup"),
    import("@/server/auth/username"),
  ]);
  const body = setupInput.parse(await request.json());
  await createSetupService().claim(body.setupToken, {
    ...body,
    username: normalizeUsername(body.username),
  });

  return NextResponse.json({ data: { initialized: true } }, { status: 201 });
}
