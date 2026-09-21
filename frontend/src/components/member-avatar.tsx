import { useEffect, useState } from "react";

const colors = ["mint", "blue", "orange", "rose", "violet", "leaf", "mint", "blue", "orange", "rose", "violet"] as const;
export const AVATAR_PRESETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];
export const DEFAULT_AVATAR_PRESET: AvatarPreset = 2;
export const AVATAR_PRESET_LABELS: Record<AvatarPreset, string> = {
  1: "人物 1",
  2: "人物 2",
  3: "人物 3",
  4: "人物 4",
  5: "人物 5",
  6: "人物 6",
  7: "猫",
  8: "狗",
  9: "熊猫",
  10: "水豚",
  11: "狐狸",
};

export function avatarPresetPath(preset: AvatarPreset): string {
  return `/member-avatars/avatar-${String(preset).padStart(2, "0")}.webp`;
}

export function avatarImagePath(userId: string, imageId: string): string {
  return `/api/users/${userId}/avatar/${imageId}`;
}

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

function validAvatarPreset(value: number | null | undefined): value is AvatarPreset {
  return AVATAR_PRESETS.includes(value as AvatarPreset);
}

/** 已绑定用户优先显示保存的插画；访客和旧数据按 member UUID 稳定回退。 */
export function MemberAvatar({ memberId, userId, displayName, avatarPreset, avatarImageId, size = "md", decorative = false }: {
  readonly memberId: string;
  readonly userId?: string | null;
  readonly displayName: string;
  readonly avatarPreset?: number | null;
  readonly avatarImageId?: string | null;
  readonly size?: "sm" | "md" | "lg";
  readonly decorative?: boolean;
}) {
  const index = stableIndex(memberId, colors.length);
  const preset = validAvatarPreset(avatarPreset) ? avatarPreset : AVATAR_PRESETS[index];
  const pixels = size === "lg" ? 64 : size === "sm" ? 34 : 40;
  const fallbackSrc = avatarPresetPath(preset);
  const source = userId && avatarImageId ? avatarImagePath(userId, avatarImageId) : fallbackSrc;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return (
    <span className={`avatar avatar--${size} avatar--${colors[preset - 1]}`} role={decorative ? undefined : "img"} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `${displayName}的头像`}>
      <img src={failed ? fallbackSrc : source} width={pixels} height={pixels} alt="" onError={() => setFailed(true)} />
    </span>
  );
}
