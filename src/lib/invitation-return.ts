const invitationCallbackPattern = /^\/join\/([A-Za-z0-9_-]{20,128})$/;

/** 认证回跳只接受单层站内邀请路径，阻止外部 URL 和任意产品页被注入。 */
export function normalizeInvitationCallbackURL(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const match = invitationCallbackPattern.exec(value);
  return match ? `/join/${match[1]}` : null;
}

export function invitationTokenFromCallbackURL(
  value: string | null | undefined,
): string | null {
  return invitationCallbackPattern.exec(value ?? "")?.[1] ?? null;
}
