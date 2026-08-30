/**
 * 解析用户主动粘贴的邀请地址。只接受当前站点的 /join/<token>，返回已验证的
 * 站内路径供 router.push 使用；所有外部地址和不符合 Token 约束的输入都会被拒绝。
 */
export function parseJoinInvitationUrl(
  value: string,
  origin = typeof window === "undefined"
    ? "http://localhost"
    : window.location.origin,
): string | null {
  const input = value.trim();
  if (!input) return null;
  let url: URL;
  try {
    if (!input.startsWith("/") && !/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
      return null;
    }
    url = new URL(input, origin);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;
  if (url.search || url.hash) return null;
  const parts = url.pathname.split("/");
  if (parts.length !== 3 || parts[1] !== "join" || !parts[2]) return null;
  let token: string;
  try {
    token = decodeURIComponent(parts[2]);
  } catch {
    return null;
  }
  if (
    token.length < 20 ||
    token.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  )
    return null;
  return `/join/${encodeURIComponent(token)}`;
}

export const parseInvitationUrl = parseJoinInvitationUrl;
