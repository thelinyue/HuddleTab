import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { asCurrencyCode } from "@/domain/currency/currency";
import { ApplicationError } from "@/server/errors/application-error";
import {
  authorizeActivityOperation,
  type ActivityAuthorization,
} from "@/server/permissions/authorize-activity-operation";

type ActivityRole = "OWNER" | "ADMIN" | "MEMBER";
type MemberStatus = "ACTIVE" | "LEFT";
type ActivityStatus = "ACTIVE" | "ENDED" | "ARCHIVED";

export interface ActivityFieldPermissions {
  readonly name: boolean;
  readonly location: boolean;
  readonly baseCurrency: boolean;
  readonly startDate: boolean;
  readonly endDate: boolean;
}

interface ActivityRow {
  readonly id: string;
  readonly name: string;
  readonly location: string | null;
  readonly base_currency: string;
  readonly start_date: string;
  readonly end_date: string | null;
  readonly status: ActivityStatus;
  readonly revision: string | bigint;
}

interface AccountingFacts {
  readonly hasAccountingRecords: boolean;
  readonly earliestExpenseDate: string | null;
}

export interface UpdateActivityDetailsInput {
  readonly revision: string;
  readonly name?: string;
  readonly location?: string | null;
  readonly baseCurrency?: string;
  readonly startDate?: string;
  readonly endDate?: string | null;
}

export function getActivityFieldPermissions(input: {
  readonly role: ActivityRole;
  readonly memberStatus: MemberStatus;
  readonly activityStatus: ActivityStatus;
  readonly hasAccountingRecords: boolean;
}): ActivityFieldPermissions {
  const manager =
    input.memberStatus === "ACTIVE" &&
    (input.role === "OWNER" || input.role === "ADMIN");
  const active = manager && input.activityStatus === "ACTIVE";
  const descriptive = manager && input.activityStatus !== "ARCHIVED";

  return {
    name: descriptive,
    location: descriptive,
    baseCurrency: active && !input.hasAccountingRecords,
    startDate: active,
    endDate: active,
  };
}

/**
 * 活动详情服务集中生成字段级权限和账务锁定事实。账务存在性不排除软删除记录，
 * 因为主币种一旦参与过金额、汇率或结算计算，就不能通过删除记录重新解锁。
 */
export class ActivityDetailsService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async get(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
  ) {
    return this.sql.begin(async (transaction) => {
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "READ",
      });
      const [activity] = await transaction<ActivityRow[]>`
        select id, name, location, base_currency, start_date, end_date, status, revision
        from activities
        where id = ${activityId}
      `;
      const accounting = await this.loadAccountingFacts(
        transaction,
        activityId,
      );

      return this.serialize(activity!, authorization, accounting);
    });
  }

  async update(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    input: UpdateActivityDetailsInput,
  ) {
    return this.sql.begin(async (transaction) => {
      if (!session) {
        throw new ApplicationError(
          "UNAUTHENTICATED",
          "登录状态已失效，请重新登录。",
          401,
        );
      }

      const [current] = await transaction<ActivityRow[]>`
        select id, name, location, base_currency, start_date, end_date, status, revision
        from activities
        where id = ${activityId}
        for update
      `;
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "ACTIVITY_UPDATE",
      });
      if (!current) {
        throw new ApplicationError(
          "ACTIVITY_NOT_FOUND",
          "活动不存在或你无权查看。",
          404,
        );
      }
      if (String(current.revision) !== input.revision) {
        throw new ApplicationError(
          "VERSION_CONFLICT",
          "活动资料已被其他成员更新，请刷新后重试。",
          409,
        );
      }

      const accounting = await this.loadAccountingFacts(
        transaction,
        activityId,
      );
      const next = {
        name: input.name ?? current.name,
        location:
          input.location === undefined ? current.location : input.location,
        baseCurrency:
          input.baseCurrency === undefined
            ? current.base_currency
            : asCurrencyCode(input.baseCurrency),
        startDate: input.startDate ?? current.start_date,
        endDate: input.endDate === undefined ? current.end_date : input.endDate,
      };
      const changes: Record<
        string,
        { readonly before: string | null; readonly after: string | null }
      > = {};
      const candidates = [
        ["name", current.name, next.name],
        ["location", current.location, next.location],
        ["baseCurrency", current.base_currency, next.baseCurrency],
        ["startDate", current.start_date, next.startDate],
        ["endDate", current.end_date, next.endDate],
      ] as const;
      for (const [field, before, after] of candidates) {
        if (before !== after) changes[field] = { before, after };
      }

      const permissions = getActivityFieldPermissions({
        role: authorization.member.role,
        memberStatus: authorization.member.status,
        activityStatus: current.status,
        hasAccountingRecords: accounting.hasAccountingRecords,
      });
      const lockedFields = Object.keys(changes).filter(
        (field) => !permissions[field as keyof ActivityFieldPermissions],
      );
      if (
        lockedFields.includes("baseCurrency") &&
        accounting.hasAccountingRecords
      ) {
        throw new ApplicationError(
          "BASE_CURRENCY_LOCKED",
          "活动已有账务记录，主币种不可修改。",
          409,
        );
      }
      if (lockedFields.length > 0) {
        throw new ApplicationError(
          "ACTIVITY_FIELD_LOCKED",
          "当前活动状态不允许修改所选字段。",
          409,
          { fields: lockedFields },
        );
      }
      if (next.endDate && next.endDate < next.startDate) {
        throw new ApplicationError(
          "INVALID_ACTIVITY_DATE_RANGE",
          "结束日期不能早于开始日期。",
          422,
        );
      }

      if (Object.keys(changes).length === 0) {
        return {
          activity: this.serialize(current, authorization, accounting),
          warnings: [] as readonly string[],
        };
      }

      const [updated] = await transaction<ActivityRow[]>`
        update activities
        set name = ${next.name},
            location = ${next.location},
            base_currency = ${next.baseCurrency},
            start_date = ${next.startDate},
            end_date = ${next.endDate},
            revision = revision + 1,
            updated_at = now()
        where id = ${activityId}
        returning id, name, location, base_currency, start_date, end_date, status, revision
      `;
      await transaction`
        insert into activity_audit_logs
          (id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata)
        values
          (${randomUUID()}, ${activityId}, ${authorization.userId}, ${authorization.member.id},
           'ACTIVITY_UPDATED', 'ACTIVITY', ${activityId}, ${JSON.stringify({ changes })}::jsonb)
      `;
      const warnings =
        changes.startDate &&
        accounting.earliestExpenseDate &&
        accounting.earliestExpenseDate < next.startDate
          ? (["EXPENSE_BEFORE_ACTIVITY_START"] as const)
          : ([] as const);

      return {
        activity: this.serialize(updated!, authorization, accounting),
        warnings,
      };
    });
  }

  private async loadAccountingFacts(
    transaction: postgres.TransactionSql,
    activityId: string,
  ): Promise<AccountingFacts> {
    const [accounting] = await transaction<
      {
        has_accounting_records: boolean;
        earliest_expense_date: string | null;
      }[]
    >`
      select
        (exists(select 1 from expenses where activity_id = ${activityId})
          or exists(select 1 from settlements where activity_id = ${activityId})) as has_accounting_records,
        (select min(occurred_at)::date::text from expenses where activity_id = ${activityId}) as earliest_expense_date
    `;
    return {
      hasAccountingRecords: Boolean(accounting?.has_accounting_records),
      earliestExpenseDate: accounting?.earliest_expense_date ?? null,
    };
  }

  private serialize(
    activity: ActivityRow,
    authorization: ActivityAuthorization,
    accounting: AccountingFacts,
  ) {
    return {
      id: activity.id,
      name: activity.name,
      location: activity.location,
      baseCurrency: activity.base_currency,
      startDate: activity.start_date,
      endDate: activity.end_date,
      status: activity.status,
      revision: String(activity.revision),
      currentMemberRole: authorization.member.role,
      currentMemberStatus: authorization.member.status,
      hasAccountingRecords: accounting.hasAccountingRecords,
      earliestExpenseDate: accounting.earliestExpenseDate,
      permissions: getActivityFieldPermissions({
        role: authorization.member.role,
        memberStatus: authorization.member.status,
        activityStatus: activity.status,
        hasAccountingRecords: accounting.hasAccountingRecords,
      }),
    };
  }
}
