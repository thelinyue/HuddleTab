"use client";

import type { QuickExpenseMember } from "@/features/expenses/components/quick-expense-form";

type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "WEIGHT";

/** 分摊输入保留用户的十进制文本，提交前才按明确规则转为 API 的精确整数。 */
export function SplitEditor({
  members,
  participantIds,
  mode,
  values,
  onValueChange,
}: {
  readonly members: readonly QuickExpenseMember[];
  readonly participantIds: readonly string[];
  readonly mode: SplitMode;
  readonly values: Readonly<Record<string, string>>;
  readonly onValueChange: (memberId: string, value: string) => void;
}) {
  if (mode === "EQUAL") return null;
  const label =
    mode === "EXACT"
      ? "成员金额"
      : mode === "PERCENTAGE"
        ? "成员比例（%）"
        : "成员权重";
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-2 space-y-2">
        {members
          .filter((member) => participantIds.includes(member.id))
          .map((member) => (
            <label
              key={member.id}
              className="grid grid-cols-[1fr_8rem] items-center gap-3"
            >
              <span>{member.displayName}</span>
              <input
                inputMode="decimal"
                aria-label={`${member.displayName}分摊值`}
                value={values[member.id] ?? ""}
                onChange={(event) =>
                  onValueChange(member.id, event.target.value)
                }
                className="min-h-11 border bg-background px-3"
              />
            </label>
          ))}
      </div>
    </fieldset>
  );
}
