"use client";

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
      <legend className="mb-2 font-medium">主题</legend>
      <div role="radiogroup" aria-label="主题" className="flex flex-wrap gap-2">
        {(
          [
            ["SYSTEM", "跟随系统"],
            ["LIGHT", "亮色"],
            ["DARK", "暗色"],
          ] as const
        ).map(([id, label]) => (
          <label
            key={id}
            className="flex min-h-11 items-center gap-2 border px-3"
          >
            <input
              type="radio"
              name="theme"
              checked={value === id}
              onChange={() => onChange(id)}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
