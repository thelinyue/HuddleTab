import { apiClient } from "./client";
import { unwrap } from "./error";

let currentToken: string | undefined;
let pendingToken: Promise<string> | undefined;

/** CSRF token 只保存在内存，并由服务端 cookie 上下文签名；切换 Session 时立即丢弃。 */
export function csrfToken(): Promise<string> {
  if (currentToken) return Promise.resolve(currentToken);
  pendingToken ??= apiClient.GET("/api/auth/csrf").then((result) => {
    const token = unwrap(result).data.token;
    currentToken = token;
    pendingToken = undefined;
    return token;
  });
  return pendingToken;
}

export function clearCsrfToken(): void {
  currentToken = undefined;
  pendingToken = undefined;
}

export async function mutationHeaders(): Promise<Record<string, string>> {
  return { "X-CSRF-Token": await csrfToken() };
}
