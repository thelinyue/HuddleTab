import Image from "next/image";

import {
  expenseCategoryIllustrations,
  type ExpenseCategory,
} from "@/features/expenses/categories";
import { cn } from "@/lib/utils";

/**
 * 分类插画只引用仓库内的固定 WebP 资产，分类名称由外层 HTML 文本提供。
 * 图片是装饰内容并从辅助技术树中隐藏，避免同一分类被朗读两次。
 */
export function ExpenseCategoryIllustration({
  category,
  className,
}: {
  readonly category: ExpenseCategory;
  readonly className?: string;
}) {
  const illustration =
    expenseCategoryIllustrations[category] ??
    expenseCategoryIllustrations.OTHER;
  return (
    <Image
      src={illustration}
      alt=""
      aria-hidden="true"
      width={512}
      height={512}
      data-category-illustration={category}
      className={cn("size-6 shrink-0 object-contain", className)}
    />
  );
}
