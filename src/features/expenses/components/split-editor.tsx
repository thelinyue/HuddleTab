"use client";

import type { QuickExpenseMember } from "@/features/expenses/components/quick-expense-form";
import { MemberAvatar } from "@/components/design-system/member-avatar";

type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "WEIGHT";

/** 分摊输入保留用户的十进制文本，提交前才按明确规则转为 API 的精确整数。 */
export function SplitEditor({
  members,
  participantIds,
  mode,
  values,
  equalPreview,
  onValueChange,
}: {
  readonly members: readonly QuickExpenseMember[];
  readonly participantIds: readonly string[];
  readonly mode: SplitMode;
  readonly values: Readonly<Record<string, string>>;
  readonly equalPreview: string;
  readonly onValueChange: (memberId: string, value: string) => void;
}) {
  const label =
    mode === "EXACT"
      ? "成员金额"
      : mode === "PERCENTAGE"
        ? "成员比例（%）"
        : "成员权重";
  const selectedMembers = members.filter((member) =>
    participantIds.includes(member.id),
  );
  return (
    <section aria-label="参与成员分摊">
      {mode !== "EQUAL" && (
        <fieldset>
          <legend className="text-sm font-medium">{label}</legend>
          <div className="mt-2 space-y-2">
            {selectedMembers.map((member) => (
              <label
                key={member.id}
                className="grid grid-cols-[1fr_8rem] items-center gap-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <MemberAvatar
                    memberId={member.id}
                    displayName={member.displayName}
                    className="size-8"
                  />
                  <span>{member.displayName}</span>
                </span>
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
      )}
      {mode === "EQUAL" && (
        <div className="space-y-2">
          {selectedMembers.map((member) => (
            <div
              key={member.id}
              className="flex min-h-11 items-center justify-between border px-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <MemberAvatar
                  memberId={member.id}
                  displayName={member.displayName}
                  className="size-8"
                />
                <span>{member.displayName}</span>
              </span>
              <span className="money text-sm">均摊参考 {equalPreview}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
