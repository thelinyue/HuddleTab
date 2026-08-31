import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { asCurrencyCode } from "@/domain/currency/currency";
import { ApplicationError } from "@/server/errors/application-error";

export interface ActivitySession {
  readonly user: { readonly id: string };
}

export interface CreateActivityInput {
  readonly session: ActivitySession | null;
  readonly name: string;
  readonly location?: string;
  readonly baseCurrency: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly ownerDisplayName: string;
}

/** 创建活动时预生成两个 ID，在延迟同活动 Owner 外键约束内原子建立账务身份。 */
export class ActivityService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async create(input: CreateActivityInput): Promise<{
    id: string;
    ownerMemberId: string;
  }> {
    if (!input.session) {
      throw new ApplicationError(
        "UNAUTHENTICATED",
        "登录状态已失效，请重新登录。",
        401,
      );
    }

    const baseCurrency = asCurrencyCode(input.baseCurrency);
    const ownerUserId = input.session.user.id;
    const activityId = randomUUID();
    const ownerMemberId = randomUUID();
    await this.sql.begin(async (transaction) => {
      await transaction`insert into activities (id, name, location, base_currency, start_date, end_date, status, owner_member_id, invite_mode, revision, created_at, updated_at)
        values (${activityId}, ${input.name}, ${input.location ?? null}, ${baseCurrency}, ${input.startDate}, ${input.endDate ?? null}, 'ACTIVE', ${ownerMemberId}, 'DIRECT_JOIN', 0, now(), now())`;
      await transaction`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at)
        values (${ownerMemberId}, ${activityId}, ${ownerUserId}, ${input.ownerDisplayName}, 'USER', 'OWNER', 'ACTIVE', now())`;
      await transaction`insert into activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata)
        values (${randomUUID()}, ${activityId}, ${ownerUserId}, ${ownerMemberId}, 'ACTIVITY_CREATED', 'ACTIVITY', ${activityId}, '{}'::jsonb)`;
    });

    return { id: activityId, ownerMemberId };
  }
}
