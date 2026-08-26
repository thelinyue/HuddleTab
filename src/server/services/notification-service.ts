import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

export const notificationTypes = [
  "ACTIVITY_INVITATION",
  "JOIN_APPROVAL_REQUESTED",
  "JOIN_APPROVAL_RESOLVED",
  "PARTICIPATING_EXPENSE_CHANGED",
  "PARTICIPATING_EXPENSE_DELETED",
  "SETTLEMENT_RECEIVED",
  "ACTIVITY_STATUS_CHANGED",
  "OWNERSHIP_CHANGED",
] as const;

export type NotificationType = (typeof notificationTypes)[number];
type NotificationInput = {
  readonly recipientUserId: string;
  readonly type: NotificationType;
  readonly targetType: string;
  readonly targetId: string;
  readonly payload: Readonly<Record<string, string>>;
};
type NotificationRow = {
  readonly id: string;
  readonly type: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly activity_id: string | null;
  readonly payload: Record<string, string>;
  readonly read_at: Date | null;
  readonly created_at: Date;
};

function asIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * 通知只表达已确认的业务事实。create 接收调用方已开启的事务，确保通知、Audit、
 * Revision 与对应业务写入一同提交或回滚；本服务不保存任意跳转 URL。
 */
export class NotificationService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async create(transaction: postgres.TransactionSql, input: NotificationInput) {
    const [notification] = await transaction<
      NotificationRow[]
    >`insert into notifications (id, recipient_user_id, type, target_type, target_id, payload)
      values (${randomUUID()}, ${input.recipientUserId}, ${input.type}, ${input.targetType}, ${input.targetId}, ${JSON.stringify(input.payload)}::jsonb)
      returning id, type, target_type, target_id, payload, read_at, created_at`;
    if (!notification) throw new Error("通知写入失败，请重试。");
    return this.serialize(notification);
  }

  async list(recipientUserId: string, limit = 50) {
    const rows = await this.sql<
      NotificationRow[]
    >`select notification.id, notification.type, notification.target_type, notification.target_id,
        coalesce(activity.id, expense.activity_id, settlement.activity_id) as activity_id,
        notification.payload, notification.read_at, notification.created_at
      from notifications notification
      left join activities activity on notification.target_type = 'ACTIVITY' and notification.target_id = activity.id
      left join expenses expense on notification.target_type = 'EXPENSE' and notification.target_id = expense.id::text
      left join settlements settlement on notification.target_type = 'SETTLEMENT' and notification.target_id = settlement.id::text
      where notification.recipient_user_id = ${recipientUserId}
      order by notification.created_at desc limit ${Math.min(Math.max(limit, 1), 50)}`;
    const [unread] = await this.sql<
      { count: string }[]
    >`select count(*) from notifications
      where recipient_user_id = ${recipientUserId} and read_at is null`;
    return {
      items: rows.map((row) => this.serialize(row)),
      unreadCount: Number(unread?.count ?? 0),
    };
  }

  async markRead(recipientUserId: string, notificationId: string) {
    const rows = await this.sql<
      { id: string }[]
    >`update notifications set read_at = coalesce(read_at, now())
      where id = ${notificationId} and recipient_user_id = ${recipientUserId}
      returning id`;
    if (!rows[0]) {
      throw new ApplicationError(
        "NOTIFICATION_NOT_FOUND",
        "通知不存在或你无权查看。",
        404,
      );
    }
  }

  private serialize(row: NotificationRow) {
    return {
      id: row.id,
      type: row.type,
      targetType: row.target_type,
      targetId: row.target_id,
      activityId: row.activity_id,
      payload: row.payload,
      readAt: row.read_at ? asIsoString(row.read_at) : null,
      createdAt: asIsoString(row.created_at),
    };
  }
}
