"use client";

import { CheckIcon } from "lucide-react";

export type ThemeValue = "SYSTEM" | "LIGHT" | "DARK";

/** 主题偏好用原生 radio 组表达，触屏、键盘和读屏用户获得相同的选择语义。 */
export function ThemeSelector({
  value,
  onChange,
}: {
  readonly value: ThemeValue;
  readonly onChange: (value: ThemeValue) => void;
}) {
  return (
    <fieldset>
      <legend className="type-label mb-2 font-medium">显示模式</legend>
      <div
        role="radiogroup"
        aria-label="主题"
        className="grid grid-cols-3 gap-2"
      >
        {(
          [
            ["SYSTEM", "跟随系统"],
            ["LIGHT", "亮色"],
            ["DARK", "暗色"],
          ] as const
        ).map(([id, label]) => (
          <label
            key={id}
            className={`type-label flex min-h-12 items-center justify-center gap-1 rounded-lg border px-2 font-medium ${
              value === id
                ? "border-primary bg-primary/10 text-primary"
                : "bg-surface text-foreground"
            }`}
          >
            <input
              type="radio"
              name="theme"
              checked={value === id}
              onChange={() => onChange(id)}
              className="sr-only"
            />
            {value === id ? (
              <CheckIcon aria-hidden="true" className="size-4" />
            ) : null}
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
