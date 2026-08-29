import Image from "next/image";

import {
  expenseCategoryIllustrations,
  type ExpenseCategory,
} from "@/features/expenses/categories";
import { cn } from "@/lib/utils";

/**
 * 分类插画统一使用圆形裁切，避免选择器、流水和详情页各自维护不同的图片样式。
 * 图片本身是无文字的装饰内容，分类名称和交互语义由外层文本或控件提供。
 */
export function ExpenseCategoryIllustration({
  category,
  className,
}: {
  readonly category: ExpenseCategory;
  readonly className?: string;
}) {
  return (
    <Image
      src={
        expenseCategoryIllustrations[category] ??
        expenseCategoryIllustrations.OTHER
      }
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 rounded-full object-cover", className)}
      loading="lazy"
      width={512}
      height={512}
      sizes="96px"
      unoptimized
    />
  );
}
