import { formatZonedTimestamp } from "@/lib/time-zone";

export interface ExpenseExportRow {
  readonly occurredAt: string;
  readonly title: string;
  readonly category: string;
  readonly originalAmount: string;
  readonly originalCurrency: string;
  readonly exchangeRate: string;
  readonly baseAmount: string;
  readonly payers: readonly {
    readonly name: string;
    readonly amount: string;
  }[];
  readonly participants: readonly {
    readonly name: string;
    readonly amount: string;
  }[];
  readonly splitMode: string;
  readonly creatorName: string;
  readonly createdAt: string;
  readonly note: string | null;
}

const header = [
  "消费时间",
  "用途",
  "分类",
  "原始金额",
  "原始币种",
  "汇率",
  "主币种金额",
  "付款人",
  "参与成员",
  "分摊方式",
  "创建人",
  "创建时间",
  "备注",
];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** CSV 仅导出已授权 Expense 事实；固定列和成员顺序由调用方在查询阶段保证。 */
export function serializeExpenseCsv(
  rows: readonly ExpenseExportRow[],
  timeZone: string,
): string {
  const body = rows.map((row) =>
    [
      formatZonedTimestamp(new Date(row.occurredAt), timeZone),
      row.title,
      row.category,
      row.originalAmount,
      row.originalCurrency,
      row.exchangeRate,
      row.baseAmount,
      row.payers.map((value) => `${value.name}:${value.amount}`).join(" | "),
      row.participants
        .map((value) => `${value.name}:${value.amount}`)
        .join(" | "),
      row.splitMode,
      row.creatorName,
      formatZonedTimestamp(new Date(row.createdAt), timeZone),
      row.note ?? "",
    ]
      .map((value) => quote(String(value)))
      .join(","),
  );
  return `\uFEFF${[header.join(","), ...body].join("\r\n")}`;
}
