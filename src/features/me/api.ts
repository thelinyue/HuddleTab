import type { AvatarPreset } from "@/features/me/avatar-presets";

export interface MeProfileDto {
  readonly username: string;
  readonly nickname: string;
  readonly emailBound: boolean;
  readonly maskedEmail: string | null;
  readonly emailVerified: boolean;
  readonly avatarPreset: AvatarPreset | null;
  readonly themePreference: "SYSTEM" | "LIGHT" | "DARK";
  readonly isSystemAdmin: boolean;
}

export interface UpdateMeProfileInput {
  readonly nickname: string;
  readonly avatarPreset?: AvatarPreset;
}

/** 我的资料 API 只传输经过服务端脱敏的账户展示字段。 */
export async function getMeProfile(): Promise<MeProfileDto> {
  const response = await fetch("/api/me/profile", { cache: "no-store" });
  if (!response.ok) throw new Error("个人资料加载失败，请稍后重试。");
  return (await response.json()).data as MeProfileDto;
}

/** 头像字段保持可选，确保旧版仅修改昵称的调用不会清空既有头像。 */
export async function updateMeProfile(
  input: UpdateMeProfileInput,
): Promise<void> {
  const response = await fetch("/api/me/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("个人资料保存失败，请稍后重试。");
}
