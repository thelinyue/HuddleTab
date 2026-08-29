"use client";

import { CheckIcon, ChevronRightIcon } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";

import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import {
  expenseCategories,
  expenseCategoryIllustrations,
  expenseCategoryLabels,
  type ExpenseCategory,
} from "@/features/expenses/categories";

/** 分类图片只承担视觉提示，名称和选中语义由按钮文本与 ARIA 属性提供。 */
function CategoryIllustration({
  category,
  className,
}: {
  readonly category: ExpenseCategory;
  readonly className: string;
}) {
  return (
    <Image
      src={expenseCategoryIllustrations[category]}
      alt=""
      aria-hidden="true"
      className={className}
      loading="lazy"
      width={512}
      height={512}
      sizes="(max-width: 480px) 96px, 120px"
      unoptimized
    />
  );
}

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
          <CategoryIllustration
            category={value}
            className="size-9 shrink-0 rounded-full object-contain"
          />
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
          className="grid grid-cols-2 gap-2 min-[481px]:grid-cols-4"
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
                className={`group relative flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border px-2 py-3 text-center outline-none transition-colors hover:bg-muted/45 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 ${selected ? "border-primary bg-primary/10" : "border-border bg-background"}`}
                onClick={() => {
                  onChange(category);
                  setOpen(false);
                }}
              >
                <CategoryIllustration
                  category={category}
                  className="size-24 object-contain transition-transform group-active:scale-95"
                />
                <span className="type-label font-medium">
                  {expenseCategoryLabels[category]}
                </span>
                <span
                  aria-hidden="true"
                  className={`absolute top-2 right-2 flex size-6 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-transparent"}`}
                >
                  {selected ? <CheckIcon className="size-4" /> : null}
                </span>
              </button>
            );
          })}
        </fieldset>
      </ResponsiveFormOverlay>
    </>
  );
}
