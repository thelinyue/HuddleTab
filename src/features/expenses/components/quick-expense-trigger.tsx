"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { QuickExpenseContextDto } from "@/features/expenses/api";
import { QuickExpenseForm } from "@/features/expenses/components/quick-expense-form";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";

/** 快速记账入口仅管理弹层和保存后的反馈，账单表单本身可被离线流程复用。 */
export function QuickExpenseTrigger({
  context,
  onSaved,
}: {
  readonly context: QuickExpenseContextDto;
  readonly onSaved: (expenseId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 bg-primary px-3 font-medium text-primary-foreground"
      >
        <PlusIcon aria-hidden="true" className="size-4" />
        记一笔
      </button>
      <ResponsiveFormOverlay
        open={open}
        onOpenChange={setOpen}
        title="记一笔消费"
      >
        <QuickExpenseForm
          activity={context.activity}
          members={context.members}
          preference={{
            lastCategory: context.preference.lastCategory as
              import("@/features/expenses/categories").ExpenseCategory | null,
            recentParticipantIds: context.preference.recentParticipantIds,
            recentPayerIds: context.preference.recentPayerIds,
            recentCurrency: context.preference.recentCurrency,
            recentTitles: context.preference.recentTitles,
          }}
          onSaved={(expense) => {
            setOpen(false);
            onSaved(expense.id);
            toast.success(`已记录「${expense.title}」金额`);
          }}
        />
      </ResponsiveFormOverlay>
    </>
  );
}
