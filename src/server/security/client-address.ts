import { isIP } from "node:net";

/**
 * 读取部署者明确声明可信代理模式后的客户端地址。
 *
 * 默认模式绝不读取任何转发 Header：应用无法从 HTTP Request 本身可靠识别直连客户端
 * 地址，猜测会把客户端可伪造的值变成安全边界。部署者仅在自身代理已重写
 * X-Real-IP、且应用端口不能被不可信客户端直连时，才可精确设置 TRUST_PROXY=true。
 */
export function getClientAddress(request: Request): string | undefined {
  if (process.env.TRUST_PROXY !== "true") {
    return undefined;
  }

  const address = request.headers.get("x-real-ip");

  // Headers 会把重复字段合并为逗号分隔值；V1 不解析代理链，故全部拒绝。
  if (!address || address.includes(",") || isIP(address) === 0) {
    return undefined;
  }

  return address;
}
