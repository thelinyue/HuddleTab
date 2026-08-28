"use client";

import type { QuickExpenseMember } from "@/features/expenses/components/quick-expense-form";
import { MemberAvatar } from "@/components/design-system/member-avatar";
import { MoneyAmount } from "@/components/design-system/money-amount";
import type { AllocationResult } from "@/domain/splitting/allocation";

type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "WEIGHT";

/** 分摊输入保留用户的十进制文本，提交前才按明确规则转为 API 的精确整数。 */
export function SplitEditor({
  members,
  participantIds,
  mode,
  values,
  currency,
  allocations,
  onValueChange,
}: {
  readonly members: readonly QuickExpenseMember[];
  readonly participantIds: readonly string[];
  readonly mode: SplitMode;
  readonly values: Readonly<Record<string, string>>;
  readonly currency: string;
  readonly allocations: readonly AllocationResult[] | null;
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
  const allocationByMemberId = new Map(
    allocations?.map((allocation) => [
      allocation.memberId,
      allocation.amountMinor,
    ]),
  );
  return (
    <section aria-label="参与成员分摊">
      <h2 className="type-label flex min-h-11 items-center font-medium">
        参与成员 · {selectedMembers.length}人
      </h2>
      <ul aria-label="参与成员承担金额" className="divide-y border-y">
        {selectedMembers.map((member) => {
          const allocation = allocationByMemberId.get(member.id);
          return (
            <li
              key={member.id}
              className="flex min-h-16 items-center gap-3 px-3 py-2"
            >
              <MemberAvatar
                memberId={member.id}
                displayName={member.displayName}
                avatarPreset={member.avatarPreset}
                className="size-10"
              />
              <span className="type-body min-w-0 flex-1 truncate font-medium">
                {member.displayName}
              </span>
              {mode !== "EQUAL" ? (
                <label className="relative flex min-h-11 w-24 items-center">
                  <span className="sr-only">{label}</span>
                  <input
                    inputMode="decimal"
                    aria-label={`${member.displayName}分摊值`}
                    value={values[member.id] ?? ""}
                    onChange={(event) =>
                      onValueChange(member.id, event.target.value)
                    }
                    className={`money type-amount min-h-11 w-full rounded-sm border bg-background px-2 text-right outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 ${mode === "EXACT" ? "" : "pr-7"}`}
                  />
                  {mode !== "EXACT" ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute right-2 text-muted-foreground"
                    >
                      {mode === "PERCENTAGE" ? "%" : "份"}
                    </span>
                  ) : null}
                </label>
              ) : null}
              {mode !== "EXACT" ? (
                allocation === undefined ? (
                  <span className="type-body min-w-20 text-right font-semibold">
                    待完成
                  </span>
                ) : (
                  <MoneyAmount
                    currency={currency}
                    amountMinor={allocation}
                    size="md"
                    className="min-w-20 text-right font-semibold"
                  />
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
