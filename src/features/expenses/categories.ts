export const expenseCategories = [
  "FOOD",
  "TRANSPORT",
  "LODGING",
  "TICKET",
  "SHOPPING",
  "ENTERTAINMENT",
  "OTHER",
] as const;

export type ExpenseCategory = (typeof expenseCategories)[number];

export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  FOOD: "餐饮",
  TRANSPORT: "交通",
  LODGING: "住宿",
  TICKET: "门票",
  SHOPPING: "购物",
  ENTERTAINMENT: "娱乐",
  OTHER: "其他",
};

/**
 * 快速记账分类选择器使用的独立插画资源。图片不包含文字，分类名称仍由
 * HTML 文本提供，保证响应式布局、主题切换和辅助技术都不依赖图片内容。
 */
export const expenseCategoryIllustrations: Record<ExpenseCategory, string> = {
  FOOD: "/expense-categories/food.webp",
  TRANSPORT: "/expense-categories/transport.webp",
  LODGING: "/expense-categories/lodging.webp",
  TICKET: "/expense-categories/ticket.webp",
  SHOPPING: "/expense-categories/shopping.webp",
  ENTERTAINMENT: "/expense-categories/entertainment.webp",
  OTHER: "/expense-categories/other.webp",
};
