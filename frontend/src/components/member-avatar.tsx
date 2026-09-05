const colors = ["mint", "blue", "orange", "rose", "violet", "leaf"] as const;
export const AVATAR_PRESETS = [1, 2, 3, 4, 5, 6] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];
export const DEFAULT_AVATAR_PRESET: AvatarPreset = 2;

export function avatarPresetPath(preset: AvatarPreset): string {
  return `/member-avatars/avatar-${String(preset).padStart(2, "0")}.webp`;
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
export function MemberAvatar({ memberId, displayName, avatarPreset, size = "md", decorative = false }: {
  readonly memberId: string;
  readonly displayName: string;
  readonly avatarPreset?: number | null;
  readonly size?: "sm" | "md" | "lg";
  readonly decorative?: boolean;
}) {
  const index = stableIndex(memberId, colors.length);
  const preset = validAvatarPreset(avatarPreset) ? avatarPreset : AVATAR_PRESETS[index];
  const pixels = size === "lg" ? 64 : size === "sm" ? 34 : 40;
  return (
    <span className={`avatar avatar--${size} avatar--${colors[preset - 1]}`} role={decorative ? undefined : "img"} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `${displayName}的头像`}>
      <img src={avatarPresetPath(preset)} width={pixels} height={pixels} alt="" />
    </span>
  );
}
