import { expect, it } from "vitest";

import { serializeExpenseCsv } from "@/server/export/expense-csv";

it("CSV 使用冻结列、BOM 和安全引号转义", () => {
  const csv = serializeExpenseCsv([
    {
      occurredAt: "2026-08-23",
      title: '晚餐, "聚会"',
      category: "FOOD",
      originalAmount: "1000",
      originalCurrency: "CNY",
      exchangeRate: "1",
      baseAmount: "1000",
      payers: [{ name: "小王", amount: "1000" }],
      participants: [{ name: "小李", amount: "1000" }],
      splitMode: "EQUAL",
      creatorName: "小王",
      createdAt: "2026-08-23T08:00:00.000Z",
      note: null,
    },
  ]);
  expect(csv).toContain(
    "消费时间,用途,分类,原始金额,原始币种,汇率,主币种金额,付款人,参与成员,分摊方式,创建人,创建时间,备注",
  );
  expect(csv).toContain('"晚餐, ""聚会"""');
  expect(csv).toContain("小王:1000");
  expect(csv.startsWith("\uFEFF")).toBe(true);
});
