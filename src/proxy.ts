import { NextResponse, type NextRequest } from "next/server";

import { isSetupRequired } from "@/server/services/setup-status-service";

/**
 * 初始化尚未完成时，所有可渲染页面都必须先进入管理员创建流程。API 仍由各自的
 * 服务端鉴权与业务校验保护，不能由这个用户体验层的重定向替代。
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (
    pathname === "/setup" ||
    pathname.startsWith("/api/") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons/")
  ) {
    return NextResponse.next();
  }

  if (await isSetupRequired()) {
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/).*)",
  ],
};
