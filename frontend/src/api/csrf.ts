import { apiClient } from "./client";
import { unwrap } from "./error";

let currentToken: string | undefined;
let pendingToken: Promise<string> | undefined;
let tokenGeneration = 0;

/** CSRF token 只保存在内存，并由服务端 cookie 上下文签名；切换 Session 时立即丢弃。 */
export function csrfToken(): Promise<string> {
  if (currentToken) return Promise.resolve(currentToken);
  if (pendingToken) return pendingToken;

  const requestGeneration = tokenGeneration;
  const request = apiClient.GET("/api/auth/csrf").then((result) => {
    const token = unwrap(result).data.token;
    // Session 切换后旧请求仍可结束，但不得把与旧 Cookie 绑定的 token 写回共享缓存。
    if (requestGeneration === tokenGeneration) {
      currentToken = token;
      if (pendingToken === request) pendingToken = undefined;
    }
    return token;
  });
  pendingToken = request;
  return request;
}

export function clearCsrfToken(): void {
  tokenGeneration += 1;
  currentToken = undefined;
  pendingToken = undefined;
}

export async function mutationHeaders(): Promise<Record<string, string>> {
  return { "X-CSRF-Token": await csrfToken() };
}
