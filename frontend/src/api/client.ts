import createClient from "openapi-fetch";
import type { paths } from "./generated/openapi";

export const AUTH_EXPIRED_EVENT = "huddletab:auth-expired";

/** 所有 feature adapter 共用这个同源客户端；组件不得绕过 adapter 直接调用它。 */
export const apiClient = createClient<paths>({
  baseUrl: "",
  credentials: "include",
});

apiClient.use({
  onResponse({ response, schemaPath }) {
    // 改密接口的 401 也表示当前密码错误，应由表单展示错误并保留当前登录状态。
    if (
      response.status === 401 &&
      schemaPath !== "/api/me/password" &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
  },
});
