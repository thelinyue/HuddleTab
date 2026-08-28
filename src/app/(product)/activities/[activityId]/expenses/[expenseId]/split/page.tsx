import { ExpenseSplitDetailLoader } from "@/features/expenses/components/expense-loaders";

/** 分摊明细保留独立深链接，刷新后重新读取账单付款与承担事实。 */
export default function ExpenseSplitDetailPage() {
  return <ExpenseSplitDetailLoader />;
}
