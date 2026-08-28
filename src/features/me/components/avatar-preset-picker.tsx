import { CheckIcon } from "lucide-react";
import Image from "next/image";

import {
  AVATAR_PRESETS,
  avatarPresetPath,
  type AvatarPreset,
} from "@/features/me/avatar-presets";
import { cn } from "@/lib/utils";

/**
 * 头像预设选择器只维护可访问的单选语义和视觉状态；网络保存仍由资料页统一处理，
 * 以确保昵称与头像在一次提交中更新，且失败时不丢失用户已选择的值。
 */
export function AvatarPresetPicker({
  value,
  onChange,
}: {
  readonly value: AvatarPreset | null;
  readonly onChange: (value: AvatarPreset) => void;
}) {
  return (
    <fieldset>
      <legend className="type-label mb-3 font-medium">选择头像</legend>
      <div
        className="grid grid-cols-3 gap-3"
        role="radiogroup"
        aria-label="头像"
      >
        {AVATAR_PRESETS.map((preset) => {
          const selected = value === preset;
          return (
            <label
              key={preset}
              className={cn(
                "relative flex min-h-12 cursor-pointer items-center justify-center rounded-lg border bg-background p-1 transition-colors focus-within:ring-3 focus-within:ring-ring/50",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name="avatarPreset"
                value={preset}
                checked={selected}
                onChange={() => onChange(preset)}
                aria-label={`头像 ${preset}`}
                aria-checked={selected}
                className="sr-only"
              />
              <Image
                src={avatarPresetPath(preset)}
                alt=""
                width={48}
                height={48}
                unoptimized
                className="size-12 rounded-full object-cover"
              />
              {selected ? (
                <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <CheckIcon aria-hidden="true" className="size-3.5" />
                  <span className="sr-only">已选择</span>
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
