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
