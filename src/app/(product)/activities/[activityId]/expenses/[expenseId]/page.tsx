import { ExpenseDetailLoader } from "@/features/expenses/components/expense-loaders";

/** 消费详情独立深链接，刷新后重新读取服务器不可变事实。 */
export default function ExpenseDetailPage() {
  return <ExpenseDetailLoader timeZone={process.env.TZ ?? "Asia/Shanghai"} />;
}
