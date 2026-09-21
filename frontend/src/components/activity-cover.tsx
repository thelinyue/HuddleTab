import { useEffect, useState } from "react";

export const ACTIVITY_COVER_PRESETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export type ActivityCoverPreset = (typeof ACTIVITY_COVER_PRESETS)[number];

export const ACTIVITY_COVER_GROUPS = [
  { label: "现有场景", presets: [1, 2, 3, 4, 5, 6] as const },
  { label: "渐变主题", presets: [7, 8, 9, 10, 11, 12] as const },
] as const;

export const ACTIVITY_COVER_LABELS: Record<ActivityCoverPreset, string> = {
  1: "城堡漫游",
  2: "城市探索",
  3: "周末露营",
  4: "一起吃饭",
  5: "海边假期",
  6: "欢乐出行",
  7: "旅行",
  8: "聚餐",
  9: "合租",
  10: "情侣",
  11: "项目",
  12: "日常通用",
};

export function activityCoverPresetPath(preset: ActivityCoverPreset): string {
  return `/activity-covers/cover-${String(preset).padStart(2, "0")}.webp`;
}

export function activityCoverImagePath(activityId: string, imageId: string): string {
  return `/api/activities/${activityId}/cover/${imageId}`;
}

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

function validPreset(value: number | null | undefined): value is ActivityCoverPreset {
  return ACTIVITY_COVER_PRESETS.includes(value as ActivityCoverPreset);
}

/** 活动封面统一处理自定义图片失败回退，避免列表、工作台分别实现不同的离线策略。 */
export function ActivityCover({
  activityId,
  coverPreset,
  coverImageId,
  className,
  alt = "",
  width,
  height,
  loading,
  decoding = "async",
}: {
  readonly activityId: string;
  readonly coverPreset?: number | null;
  readonly coverImageId?: string | null;
  readonly className?: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly loading?: "eager" | "lazy";
  readonly decoding?: "sync" | "async" | "auto";
}) {
  const fallbackPreset = validPreset(coverPreset)
    ? coverPreset
    : (stableIndex(activityId, 6) + 1) as ActivityCoverPreset;
  const fallbackSrc = activityCoverPresetPath(fallbackPreset);
  const source = coverImageId ? activityCoverImagePath(activityId, coverImageId) : fallbackSrc;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return (
    <img
      className={className}
      src={failed ? fallbackSrc : source}
      width={width}
      height={height}
      alt={alt}
      loading={loading}
      decoding={decoding}
      onError={() => setFailed(true)}
    />
  );
}
