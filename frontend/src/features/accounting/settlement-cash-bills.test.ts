import { describe, expect, it } from "vitest";
import type { ExpenseAggregate, Settlement } from "./api";
import { settlementCashBillSummary } from "./settlement-cash-bills";

function record(fields: Partial<Settlement>) { return { status: "ACTIVE", ...fields } as Settlement; }
function bill(id: string, year: number, month: number, day: number): ExpenseAggregate {
  return { expense: { expenseId: id, occurredAt: new Date(year, month - 1, day, 12).toISOString() } } as ExpenseAggregate;
}
function byId(bills: ExpenseAggregate[]) { return new Map(bills.map(item => [item.expense.expenseId, item])); }

describe("清偿账单摘要", () => {
  it("跨账路径中的账单去重，空路径不算账单或日期", () => {
    const settlement = record({
      scopeExpenseIds: ["unrelated"], scopeDates: ["2020-01-01"],
      cashApplications: [
        { expenseIds: ["a", "b"], amountMinor: "100" },
        { expenseIds: ["a", "c"], amountMinor: "200" },
        { expenseIds: ["d"], amountMinor: "300" },
        { expenseIds: [], amountMinor: "400" },
      ],
    });
    const bills = [bill("a", 2026, 9, 20), bill("b", 2026, 9, 20), bill("c", 2026, 9, 22), bill("d", 2026, 9, 24)];
    expect(settlementCashBillSummary(settlement, byId(bills), false)).toBe("清偿账单 3 天 · 4 笔");
  });

  it("两天跨年时显示年份，账单日期修改后使用当前日期", () => {
    const settlement = record({ cashApplications: [{ expenseIds: ["a", "b"], amountMinor: "100" }] });
    expect(settlementCashBillSummary(settlement, byId([bill("a", 2025, 12, 31), bill("b", 2026, 1, 1)]), false))
      .toBe("清偿账单 2025/12/31、2026/1/1 · 2 笔");
    expect(settlementCashBillSummary(settlement, byId([bill("a", 2026, 1, 1), bill("b", 2026, 1, 1)]), false))
      .toBe("清偿账单 1/1 · 2 笔");
  });

  it("账单加载中或缺失时保留去重笔数，不推测不完整的日期", () => {
    const settlement = record({ cashApplications: [{ expenseIds: ["a", "missing"], amountMinor: "100" }, { expenseIds: ["missing"], amountMinor: "200" }] });
    const bills = byId([bill("a", 2026, 9, 20)]);
    expect(settlementCashBillSummary(settlement, bills, true)).toBe("清偿账单 日期读取中 · 2 笔");
    expect(settlementCashBillSummary(settlement, bills, false)).toBe("清偿账单 日期暂不可用 · 2 笔");
  });

  it("旧快照、空明细、未关联现金和作废记录不伪造清偿账单", () => {
    const bills = byId([bill("a", 2026, 9, 20)]);
    expect(settlementCashBillSummary(record({ scopeExpenseIds: ["a"] }), bills, false)).toBe("清偿明细待同步");
    expect(settlementCashBillSummary(record({ cashApplications: [] }), bills, false)).toBe("清偿明细待核对");
    expect(settlementCashBillSummary(record({ cashApplications: [{ expenseIds: [], amountMinor: "100" }] }), bills, false)).toBe("未关联账单");
    expect(settlementCashBillSummary(record({ status: "VOID", cashApplications: [{ expenseIds: ["a"], amountMinor: "100" }] }), bills, false)).toBe("查看结算明细");
  });
});
