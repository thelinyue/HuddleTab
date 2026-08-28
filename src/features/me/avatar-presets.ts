export const AVATAR_PRESETS = [1, 2, 3, 4, 5, 6] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];
export const DEFAULT_AVATAR_PRESET: AvatarPreset = 2;
export const avatarPresetPath = (preset: AvatarPreset) =>
  `/member-avatars/avatar-${String(preset).padStart(2, "0")}.webp`;
