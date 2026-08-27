import Image from "next/image";

import { cn } from "@/lib/utils";

import { stableVisualIndex } from "./visual-index";

const coverPaths = [
  "/activity-covers/cover-01.webp",
  "/activity-covers/cover-02.webp",
  "/activity-covers/cover-03.webp",
  "/activity-covers/cover-04.webp",
  "/activity-covers/cover-05.webp",
  "/activity-covers/cover-06.webp",
] as const;

/**
 * 本地预设封面是缺少活动图片时的稳定回退。活动名称同时可见时图片只承担氛围作用，
 * 必须从辅助技术树隐藏，避免重复朗读同一标题。
 */
export function ActivityCover({
  activityId,
  activityName,
  imageUrl,
  className,
}: {
  readonly activityId: string;
  readonly activityName?: string;
  readonly imageUrl?: string | null;
  readonly className?: string;
}) {
  const source = imageUrl ?? coverPaths[stableVisualIndex(activityId, coverPaths.length)];
  const isDecorative = Boolean(activityName?.trim());

  return (
    <Image
      src={source}
      alt={isDecorative ? "" : "活动封面"}
      role={isDecorative ? "presentation" : undefined}
      data-cover-index={imageUrl ? undefined : stableVisualIndex(activityId, coverPaths.length)}
      width={1200}
      height={900}
      sizes="(max-width: 767px) 96px, 160px"
      unoptimized
      className={cn("aspect-[4/3] w-full object-cover", className)}
    />
  );
}
