import Image from "next/image";

import { cn } from "@/lib/utils";

import { stableVisualIndex } from "./visual-index";

const avatarColorClassName = [
  "bg-[#d9efe8] text-[#146b52] dark:bg-[#164a3b] dark:text-[#8ce3c5]",
  "bg-[#dce9f6] text-[#245a8d] dark:bg-[#203d59] dark:text-[#a9d0f5]",
  "bg-[#f8e7d0] text-[#945e16] dark:bg-[#563d1d] dark:text-[#f1c27d]",
  "bg-[#f4dfe3] text-[#9b4057] dark:bg-[#532b37] dark:text-[#f0a1b3]",
  "bg-[#e7e0f5] text-[#65439b] dark:bg-[#3c2d5c] dark:text-[#cbb7f3]",
  "bg-[#e3ebdc] text-[#4f7041] dark:bg-[#30482b] dark:text-[#b9dda8]",
] as const;

/**
 * 成员头像没有上传图时以名称首个 Unicode 字符回退。颜色仅由 memberId 决定，
 * 因此正式成员与访客使用相同映射，不会因角色改变而造成视觉跳变。
 */
export function MemberAvatar({
  memberId,
  displayName,
  imageUrl,
  className,
}: {
  readonly memberId: string;
  readonly displayName: string;
  readonly imageUrl?: string | null;
  readonly className?: string;
}) {
  const name = displayName.trim();
  const label = name || "未命名成员";
  const initial = Array.from(name)[0] ?? "?";
  const colorIndex = stableVisualIndex(memberId, avatarColorClassName.length);

  return (
    <span
      role="img"
      aria-label={`${label}的头像`}
      data-avatar-color-index={colorIndex}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold",
        avatarColorClassName[colorIndex],
        className,
      )}
    >
      {imageUrl ? (
        // 未来头像可能来自需鉴权的任意地址，因此保留原始 src，不走服务端图片代理。
        <Image
          src={imageUrl}
          alt=""
          width={40}
          height={40}
          unoptimized
          className="size-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  );
}
