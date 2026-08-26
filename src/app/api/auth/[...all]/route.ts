import { toNextJsHandler } from "better-auth/next-js";

export const dynamic = "force-dynamic";

const nativeEmailSignUpPath = "/api/auth/sign-up/email";

async function getHandler() {
  const { auth } = await import("@/server/auth/auth");

  return toNextJsHandler(auth);
}

export async function GET(request: Request): Promise<Response> {
  return (await getHandler()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  if (new URL(request.url).pathname === nativeEmailSignUpPath) {
    // 产品注册必须经过 /api/auth/register 的邀请策略，不能暴露 Better Auth 的原生注册入口。
    return Response.json(
      {
        error: {
          code: "AUTH_ENDPOINT_NOT_AVAILABLE",
          message: "请求的认证端点不存在。",
        },
      },
      { status: 404 },
    );
  }

  return (await getHandler()).POST(request);
}
