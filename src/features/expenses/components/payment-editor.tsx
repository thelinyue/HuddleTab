"use client";

import type { QuickExpenseMember } from "@/features/expenses/components/quick-expense-form";

/**
 * 多付款人编辑器只收集原币金额字符串。总额守恒和换算属于表单提交及服务端
 * Domain 的职责，组件不在浏览器端做任何可能失真的金额运算。
 */
export function PaymentEditor({
  members,
  payerIds,
  values,
  onPayerIdsChange,
  onValueChange,
}: {
  readonly members: readonly QuickExpenseMember[];
  readonly payerIds: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  readonly onPayerIdsChange: (ids: string[]) => void;
  readonly onValueChange: (memberId: string, value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">多人付款</legend>
      <div className="mt-2 space-y-2">
        {members.map((member) => {
          const checked = payerIds.includes(member.id);
          return (
            <div
              key={member.id}
              className="grid grid-cols-[1fr_8rem] items-center gap-3"
            >
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={`${member.displayName}作为付款人`}
                  onChange={(event) =>
                    onPayerIdsChange(
                      event.target.checked
                        ? [...payerIds, member.id]
                        : payerIds.filter((id) => id !== member.id),
                    )
                  }
                />
                {member.displayName}
              </label>
              {checked && (
                <input
                  inputMode="decimal"
                  aria-label={`${member.displayName}付款金额`}
                  value={values[member.id] ?? ""}
                  onChange={(event) =>
                    onValueChange(member.id, event.target.value)
                  }
                  className="min-h-11 border bg-background px-3"
                />
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
