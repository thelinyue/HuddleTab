import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";

/** Better Auth 的 catch-all 路由仅转发 GET 与 POST 请求，不承载业务注册策略。 */
export const { GET, POST } = toNextJsHandler(auth);
