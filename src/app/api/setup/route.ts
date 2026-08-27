import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const setupInput = z.object({
  username: z.string(),
  password: z.string().min(8).max(128),
  nickname: z.string().trim().min(1).max(40),
});

export async function GET() {
  const { isSetupRequired } =
    await import("@/server/services/setup-status-service");

  return NextResponse.json({
    data: { setupRequired: await isSetupRequired() },
  });
}

export async function POST(request: Request) {
  const [
    { createSetupService },
    { normalizeUsername },
    { sql },
    { RateLimiter },
    { authRuntimeConfig },
    { resolveClientIp },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/bootstrap/initialize-setup"),
    import("@/server/auth/username"),
    import("@/server/db/client"),
    import("@/server/security/rate-limiter"),
    import("@/server/auth/runtime-config"),
    import("@/server/security/client-ip"),
    import("@/server/http/application-error-response"),
  ]);
  const body = setupInput.parse(await request.json());
  try {
    const username = normalizeUsername(body.username);
    const clientIp = resolveClientIp({
      trustedProxy: process.env.TRUST_PROXY === "true",
      connectionIp: "direct-connection",
      headers: request.headers,
    });
    await new RateLimiter(sql, authRuntimeConfig.secret).consume(
      "SETUP",
      `${clientIp}:${username}`,
      { limit: 5, windowSeconds: 600 },
    );
    await createSetupService().claim({ ...body, username });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }

  return NextResponse.json({ data: { initialized: true } }, { status: 201 });
}
