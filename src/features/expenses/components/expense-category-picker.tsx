"use client";

import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useRef, useState } from "react";

import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import { ExpenseCategoryIllustration } from "@/features/expenses/components/expense-category-illustration";
import {
  expenseCategories,
  expenseCategoryLabels,
  type ExpenseCategory,
} from "@/features/expenses/categories";

/**
 * 分类选择器把固定分类的展示、单选语义和轻量 Overlay 收在一起，调用方只需
 * 持有当前分类值。单选完成后立即关闭，取消或按 Escape 关闭不会改写表单值。
 */
export function ExpenseCategoryPicker({
  value,
  onChange,
}: {
  readonly value: ExpenseCategory;
  readonly onChange: (category: ExpenseCategory) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="分类"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full rounded-md border bg-surface px-3 py-2 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        onClick={() => setOpen(true)}
      >
        <span className="type-caption block text-muted-foreground">分类</span>
        <span className="flex min-h-11 items-center gap-2">
          <ExpenseCategoryIllustration category={value} className="size-9" />
          <span className="type-body min-w-0 flex-1 truncate font-medium">
            {expenseCategoryLabels[value]}
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </span>
      </button>

      <ResponsiveFormOverlay
        open={open}
        onOpenChange={setOpen}
        title="分类"
        returnFocusRef={triggerRef}
      >
        <fieldset
          role="radiogroup"
          aria-label="分类"
          className="grid grid-cols-5 gap-x-1 gap-y-2"
        >
          <legend className="sr-only">选择分类</legend>
          {expenseCategories.map((category) => {
            const selected = category === value;
            return (
              <button
                key={category}
                type="button"
                role="radio"
                aria-checked={selected}
                className="group relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-0.5 py-1 text-center outline-none transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/40"
                onClick={() => {
                  onChange(category);
                  setOpen(false);
                }}
              >
                <ExpenseCategoryIllustration
                  category={category}
                  className={`size-10 transition-transform group-active:scale-95 ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
                />
                <span className="type-caption font-medium leading-4">
                  {expenseCategoryLabels[category]}
                </span>
                <span
                  aria-hidden="true"
                  className={`absolute top-0 right-0 flex size-4 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-transparent"}`}
                >
                  {selected ? <CheckIcon className="size-3" /> : null}
                </span>
              </button>
            );
          })}
        </fieldset>
      </ResponsiveFormOverlay>
    </>
  );
}
