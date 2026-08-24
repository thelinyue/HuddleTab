import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";

const handlers = toNextJsHandler(auth);

/**
 * 浏览器不得直接访问 Better Auth 的 email 注册入口，否则会绕过 HuddleTab 的注册策略。
 * 此判断位于转发到 auth.handler 之前，因此被拒绝的请求不会读取认证或数据库运行时配置；
 * RegistrationService 仍可在进程内调用 auth.api.signUpEmail() 创建已通过门禁的账号。
 */
export async function POST(request: Request): Promise<Response> {
  if (new URL(request.url).pathname === "/api/auth/sign-up/email") {
    return Response.json(
      {
        code: "AUTH_REGISTRATION_PATH_DISABLED",
        message: "请使用 /api/auth/register 完成注册。",
      },
      { status: 404 },
    );
  }

  return handlers.POST(request);
}

/** 其他 Better Auth 路由继续由官方 Next.js 适配器处理。 */
export const GET = handlers.GET;
