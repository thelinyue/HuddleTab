import {
  BedDoubleIcon,
  CarFrontIcon,
  CircleHelpIcon,
  PartyPopperIcon,
  ShoppingBagIcon,
  TicketIcon,
  UtensilsIcon,
  type LucideIcon,
} from "lucide-react";

import type { ExpenseCategory } from "@/features/expenses/categories";
import { cn } from "@/lib/utils";

const categoryIcons: Record<ExpenseCategory, LucideIcon> = {
  FOOD: UtensilsIcon,
  TRANSPORT: CarFrontIcon,
  LODGING: BedDoubleIcon,
  TICKET: TicketIcon,
  SHOPPING: ShoppingBagIcon,
  ENTERTAINMENT: PartyPopperIcon,
  OTHER: CircleHelpIcon,
};

const categoryColors: Record<ExpenseCategory, string> = {
  FOOD: "text-orange-600 dark:text-orange-400",
  TRANSPORT: "text-blue-600 dark:text-blue-400",
  LODGING: "text-amber-600 dark:text-amber-400",
  TICKET: "text-violet-600 dark:text-violet-400",
  SHOPPING: "text-rose-600 dark:text-rose-400",
  ENTERTAINMENT: "text-cyan-600 dark:text-cyan-400",
  OTHER: "text-muted-foreground",
};

/**
 * 分类统一使用同一线性图标映射，并以颜色区分场景；不添加淡色圆形底，避免和头像、
 * 操作按钮的容器层级混淆。图标本身是无文字的装饰内容，分类名称和交互语义由外层提供。
 */
export function ExpenseCategoryIllustration({
  category,
  className,
}: {
  readonly category: ExpenseCategory;
  readonly className?: string;
}) {
  const Icon = categoryIcons[category] ?? categoryIcons.OTHER;
  return (
    <Icon
      aria-hidden="true"
      data-category-icon={category}
      strokeWidth={1.8}
      className={cn("size-6 shrink-0", categoryColors[category], className)}
    />
  );
}
