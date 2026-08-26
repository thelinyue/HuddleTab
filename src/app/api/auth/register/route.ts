import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const rejectingVerifier = {
  verify: async () => false,
};

/** Phase 3 注入活动邀请验证器前，INVITE_ONLY 始终拒绝普通注册。 */
export async function POST(request: Request) {
  const [{ auth }, { RegistrationService }, { db }, { registerInput }] =
    await Promise.all([
      import("@/server/auth/auth"),
      import("@/server/services/registration-service"),
      import("@/server/db/client"),
      import("@/server/validation/auth"),
    ]);
  const input = registerInput.parse(await request.json());
  const data = await new RegistrationService(rejectingVerifier, {
    database: db,
    credentials: auth.api,
  }).register(input);

  return NextResponse.json({ data }, { status: 201 });
}
