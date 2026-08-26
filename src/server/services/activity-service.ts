import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";

export type CreateActivityInput = {
  name: string;
  baseCurrency: string;
  startDate: string;
  ownerUserId: string;
  ownerDisplayName: string;
};

/**
 * 活动与首位 Owner 之间存在延迟循环外键，因此必须在同一事务中按活动、成员、审计的顺序写入，
 * 只在提交时校验 owner 指针，避免落下没有 Owner 的活动记录。
 */
export class ActivityService {
  constructor(private readonly sql: Sql) {}

  async create(input: CreateActivityInput): Promise<{
    id: string;
    ownerMemberId: string;
  }> {
    const activityId = randomUUID();
    const ownerMemberId = randomUUID();

    await this.sql.begin(async (transaction) => {
      await transaction`
        insert into activities (
          id, name, base_currency, start_date, status, owner_member_id, invite_mode, revision
        )
        values (
          ${activityId}, ${input.name}, ${input.baseCurrency}, ${input.startDate}, 'ACTIVE',
          ${ownerMemberId}, 'DIRECT_JOIN', 0
        )
      `;
      await transaction`
        insert into activity_members (
          id, activity_id, user_id, display_name, member_type, role, status
        )
        values (
          ${ownerMemberId}, ${activityId}, ${input.ownerUserId}, ${input.ownerDisplayName},
          'USER', 'OWNER', 'ACTIVE'
        )
      `;
      await transaction`
        insert into activity_audit_logs (
          id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata
        )
        values (
          ${randomUUID()}, ${activityId}, ${input.ownerUserId}, ${ownerMemberId},
          'ACTIVITY_CREATED', 'ACTIVITY', ${activityId}, '{}'::jsonb
        )
      `;
    });

    return { id: activityId, ownerMemberId };
  }
}
