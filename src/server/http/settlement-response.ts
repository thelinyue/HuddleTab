/** Settlement API 的精确金额与时间序列化，避免 bigint 进入 JSON。 */
export function serializeSettlement(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    activityId: String(row.activity_id),
    payerMemberId: String(row.payer_member_id),
    receiverMemberId: String(row.receiver_member_id),
    amountMinor: String(row.amount_minor),
    currency: String(row.currency),
    occurredAt:
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : String(row.occurred_at),
    note: row.note === null ? null : String(row.note),
    createdByMemberId: String(row.created_by_member_id),
    version: Number(row.version),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}
