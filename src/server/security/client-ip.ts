import { isIP } from "node:net";

import { ApplicationError } from "@/server/errors/application-error";

export interface ClientIpInput {
  readonly trustedProxy: boolean;
  readonly connectionIp: string;
  readonly headers: Headers;
}

/**
 * 代理信任是部署者的显式安全边界。关闭时绝不读取客户端可伪造 Header；
 * 开启时只使用代理覆盖后写入的单个 X-Real-IP，不尝试猜测代理链。
 */
export function resolveClientIp(input: ClientIpInput): string {
  if (!input.trustedProxy) return input.connectionIp;

  const proxyIp = input.headers.get("x-real-ip");
  if (!proxyIp || proxyIp.includes(",") || isIP(proxyIp.trim()) === 0) {
    throw new ApplicationError(
      "TRUSTED_PROXY_IP_INVALID",
      "可信代理返回的 X-Real-IP 无效。",
      400,
    );
  }

  return proxyIp.trim();
}
