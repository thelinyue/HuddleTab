import { toNextJsHandler } from "better-auth/next-js";

export const dynamic = "force-dynamic";

async function getHandler() {
  const { auth } = await import("@/server/auth/auth");

  return toNextJsHandler(auth);
}

export async function GET(request: Request): Promise<Response> {
  return (await getHandler()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return (await getHandler()).POST(request);
}
