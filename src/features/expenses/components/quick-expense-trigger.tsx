"use client";

import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { QuickExpenseContextDto } from "@/features/expenses/api";
import {
  QuickExpenseForm,
  type QuickExpenseStep,
} from "@/features/expenses/components/quick-expense-form";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import { useOnlineStatus } from "@/features/expenses/components/offline-status";

/** 快速记账入口仅管理弹层和保存后的反馈，账单表单本身可被离线流程复用。 */
export function QuickExpenseTrigger({
  context,
  onSaved,
  onQueued,
}: {
  readonly context: QuickExpenseContextDto;
  readonly onSaved: (expenseId: string) => void;
  readonly onQueued?: (mutationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<QuickExpenseStep>("ENTRY");
  const [splitValid, setSplitValid] = useState(false);
  const online = useOnlineStatus();
  const updateOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setStep("ENTRY");
      setSplitValid(false);
    }
  };
  return (
    <>
      <button
        type="button"
        aria-label="记一笔"
        onClick={() => {
          setStep("ENTRY");
          setSplitValid(false);
          setOpen(true);
        }}
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <PlusIcon aria-hidden="true" className="size-6" />
      </button>
      <ResponsiveFormOverlay
        open={open}
        onOpenChange={updateOpen}
        title={step === "SPLIT" ? "分摊设置" : "记一笔"}
        mobileFullScreen
        headerStart={
          step === "SPLIT" ? (
            <button
              type="button"
              aria-label="返回快速记账"
              onClick={() => setStep("ENTRY")}
              className="inline-flex size-11 items-center justify-center rounded-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ArrowLeftIcon aria-hidden="true" className="size-5" />
            </button>
          ) : undefined
        }
        headerEnd={
          step === "SPLIT" ? (
            <button
              type="button"
              aria-label="完成"
              disabled={!splitValid}
              onClick={() => setStep("ENTRY")}
              className="type-label inline-flex min-h-11 items-center justify-center rounded-sm px-3 font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:text-muted-foreground"
            >
              完成
            </button>
          ) : undefined
        }
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
          online={online}
          step={step}
          onStepChange={setStep}
          onSplitValidityChange={setSplitValid}
          onSaved={(expense) => {
            updateOpen(false);
            onSaved(expense.id);
            toast.success(`已记录「${expense.title}」金额`);
          }}
          onQueued={(mutationId) => {
            updateOpen(false);
            toast.success("已保存到本机，联网后自动同步。");
            onQueued?.(mutationId);
          }}
        />
      </ResponsiveFormOverlay>
    </>
  );
}
