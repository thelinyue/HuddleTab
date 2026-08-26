/** 将 PostgreSQL 的 bigint 和时间字段转换为 Route Handler 可安全返回的 JSON。 */
function asString(value: unknown): string {
  return String(value);
}

function asIsoTime(value: unknown): string {
  return value instanceof Date ? value.toISOString() : asString(value);
}

type Row = Record<string, unknown>;

/** Expense 传输格式使用 camelCase，并且所有金额保持精确字符串。 */
export function serializeExpense(row: Row) {
  return {
    id: asString(row.id),
    activityId: asString(row.activity_id),
    title: asString(row.title),
    category: asString(row.category),
    originalCurrency: asString(row.original_currency),
    originalAmountMinor: asString(row.original_amount_minor),
    baseCurrency: asString(row.base_currency),
    baseAmountMinor: asString(row.base_amount_minor),
    exchangeRate: asString(row.exchange_rate),
    exchangeRateSource: asString(row.exchange_rate_source),
    exchangeRateAt: asIsoTime(row.exchange_rate_at),
    splitMode: asString(row.split_mode),
    occurredAt: asIsoTime(row.occurred_at),
    note: row.note === null ? null : asString(row.note),
    createdByMemberId: asString(row.created_by_member_id),
    createdByUserId: asString(row.created_by_user_id),
    createdByDisplayName:
      row.created_by_display_name === undefined
        ? null
        : asString(row.created_by_display_name),
    version: Number(row.version),
    createdAt: asIsoTime(row.created_at),
    updatedAt: asIsoTime(row.updated_at),
  };
}

export function serializeExpensePayment(row: Row) {
  return {
    memberId: asString(row.activity_member_id),
    memberDisplayName: asString(row.member_display_name),
    originalAmountMinor: asString(row.original_amount_minor),
    baseAmountMinor: asString(row.base_amount_minor),
  };
}

export function serializeExpenseShare(row: Row) {
  return {
    memberId: asString(row.activity_member_id),
    memberDisplayName: asString(row.member_display_name),
    splitInputMinor:
      row.split_input_minor === null ? null : asString(row.split_input_minor),
    originalAmountMinor: asString(row.original_amount_minor),
    baseAmountMinor: asString(row.base_amount_minor),
  };
}
