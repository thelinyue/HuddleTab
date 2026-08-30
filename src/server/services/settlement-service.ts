import type postgres from "postgres";

import { calculateLedger, type LedgerBalance } from "@/domain/ledger/ledger";
import { recommendSettlements } from "@/domain/settlement/recommendation";
import { formatMoney } from "@/domain/money/money";
import { asCurrencyCode } from "@/domain/currency/currency";
import type { AvatarPreset } from "@/features/me/avatar-presets";
import type {
  CreateSettlementRequest,
  UpdateSettlementRequest,
} from "@/features/settlements/contracts";
import { ApplicationError } from "@/server/errors/application-error";
import { authorizeActivityOperation } from "@/server/permissions/authorize-activity-operation";
import { LedgerRepository } from "@/server/repositories/ledger-repository";
import { SettlementRepository } from "@/server/repositories/settlement-repository";
import { NotificationService } from "@/server/services/notification-service";

/**
 * 真实结算的唯一写入口。权限判断始终先于成员事实写入；后续超额确认和版本更新
 * 也必须复用此入口，不能让 Route Handler 直接操作 settlements 表。
 */
export class SettlementService {
  private readonly repository = new SettlementRepository();
  private readonly ledgerRepository = new LedgerRepository();
  private readonly notifications: NotificationService;

  constructor(private readonly sql: ReturnType<typeof postgres>) {
    this.notifications = new NotificationService(sql);
  }

  async list(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
  ) {
    return this.sql.begin(async (transaction) => {
      await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "LEDGER_READ",
      });
      return this.repository.list(transaction, activityId);
    });
  }

  /**
   * 结算页的最小只读快照。成员姓名属于 ActivityMember 账务身份，不读取用户邮箱；
   * 推荐由本次 Ledger 事实即时计算，绝不作为可写入或持久化的权威记录。
   */
  async getPageContext(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
  ) {
    return this.sql.begin(async (transaction) => {
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "LEDGER_READ",
      });
      const [activity] =
        await transaction`select name from activities where id = ${activityId}`;
      const members =
        await transaction`select member.id, member.display_name, member.status, member.member_type, profile.avatar_preset
          from activity_members member
          left join user_profiles profile on profile.user_id = member.user_id
          where member.activity_id = ${activityId}
          order by member.id`;
      const balances = calculateLedger(
        await this.ledgerRepository.loadFacts(transaction, activityId),
      );
      return {
        activity: {
          id: activityId,
          name: activity!.name,
          currency: authorization.activity.baseCurrency,
          status: authorization.activity.status,
          currentMemberId: authorization.member.id,
          currentMemberStatus: authorization.member.status,
          currentMemberRole: authorization.member.role,
        },
        members: members.map((member) => ({
          id: member.id,
          displayName: member.display_name,
          status: member.status,
          avatarPreset:
            member.member_type === "USER"
              ? ((member.avatar_preset as AvatarPreset | null) ?? null)
              : null,
        })),
        balances: balances.map((balance) => ({
          memberId: balance.memberId,
          netMinor: balance.netMinor.toString(),
        })),
        recommendations: recommendSettlements(balances).map((row) => ({
          payerMemberId: row.payerMemberId,
          receiverMemberId: row.receiverMemberId,
          amountMinor: row.amountMinor.toString(),
        })),
      };
    });
  }

  async create(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    input: CreateSettlementRequest,
  ) {
    return this.sql.begin(async (transaction) => {
      await this.repository.lockActivity(transaction, activityId);
      const authorization = await this.authorizeWrite(
        transaction,
        session,
        activityId,
        input,
        "SETTLEMENT_CREATE",
      );
      await this.requireOverSettlementConfirmation(
        transaction,
        activityId,
        input,
        authorization.activity.baseCurrency,
      );
      const settlement = await this.repository.insert(transaction, {
        ...input,
        activityId,
        currency: authorization.activity.baseCurrency,
        createdByMemberId: authorization.member.id,
      });
      await this.repository.insertAudit(transaction, {
        activityId,
        actorUserId: authorization.userId,
        actorMemberId: authorization.member.id,
        targetId: settlement.id,
      });
      await this.createReceiverNotification(
        transaction,
        authorization.userId,
        settlement.id,
        input.receiverMemberId,
        input.amountMinor,
        authorization.activity.baseCurrency,
      );
      await this.repository.incrementRevision(transaction, activityId);
      return { settlement };
    });
  }

  async update(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    settlementId: string,
    input: UpdateSettlementRequest,
  ) {
    return this.sql.begin(async (transaction) => {
      await this.repository.lockActivity(transaction, activityId);
      const current = await this.repository.requireCurrent(
        transaction,
        activityId,
        settlementId,
      );
      const authorization = await this.authorizeWrite(
        transaction,
        session,
        activityId,
        input,
        "SETTLEMENT_UPDATE",
        current.created_by_member_id,
      );
      await this.requireOverSettlementConfirmation(
        transaction,
        activityId,
        input,
        authorization.activity.baseCurrency,
        settlementId,
      );
      const updated = await this.repository.updateWhereVersion(
        transaction,
        settlementId,
        input,
      );
      if (!updated)
        throw new ApplicationError(
          "VERSION_CONFLICT",
          "这笔结算已被其他人修改，请刷新后重试",
          409,
        );
      await this.repository.insertAudit(transaction, {
        activityId,
        actorUserId: authorization.userId,
        actorMemberId: authorization.member.id,
        targetId: settlementId,
        eventType: "SETTLEMENT_UPDATED",
      });
      await this.repository.incrementRevision(transaction, activityId);
      return { settlement: updated };
    });
  }

  async remove(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    settlementId: string,
    version: number,
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await this.repository.lockActivity(transaction, activityId);
      const current = await this.repository.requireCurrent(
        transaction,
        activityId,
        settlementId,
      );
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "SETTLEMENT_DELETE",
        resourceOwnerMemberId: current.created_by_member_id,
        settlementPayerMemberId: current.payer_member_id,
      });
      const removed = await this.repository.softDeleteWhereVersion(
        transaction,
        settlementId,
        version,
        authorization.member.id,
      );
      if (!removed)
        throw new ApplicationError(
          "VERSION_CONFLICT",
          "这笔结算已被其他人修改或删除，请刷新后重试",
          409,
        );
      await this.repository.insertAudit(transaction, {
        activityId,
        actorUserId: authorization.userId,
        actorMemberId: authorization.member.id,
        targetId: settlementId,
        eventType: "SETTLEMENT_DELETED",
      });
      await this.repository.incrementRevision(transaction, activityId);
    });
  }

  private async authorizeWrite(
    transaction: postgres.TransactionSql,
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    input: CreateSettlementRequest,
    operation: "SETTLEMENT_CREATE" | "SETTLEMENT_UPDATE",
    resourceOwnerMemberId?: string,
  ) {
    const authorization = await authorizeActivityOperation(transaction, {
      session,
      activityId,
      operation,
      resourceOwnerMemberId,
      settlementPayerMemberId: input.payerMemberId,
    });
    await this.repository.requireAccountingMember(
      transaction,
      activityId,
      input.payerMemberId,
    );
    await this.repository.requireAccountingMember(
      transaction,
      activityId,
      input.receiverMemberId,
    );
    return authorization;
  }

  private async requireOverSettlementConfirmation(
    transaction: postgres.TransactionSql,
    activityId: string,
    input: CreateSettlementRequest,
    currency: string,
    excludeSettlementId?: string,
  ): Promise<void> {
    const currentPayable = payableFromTo(
      calculateLedger(
        await this.ledgerRepository.loadFacts(
          transaction,
          activityId,
          excludeSettlementId,
        ),
      ),
      input.payerMemberId,
      input.receiverMemberId,
    );
    const overAmount = BigInt(input.amountMinor) - currentPayable;
    if (overAmount <= 0n || input.confirmOverSettlement) return;
    throw new ApplicationError(
      "OVER_SETTLEMENT_CONFIRMATION_REQUIRED",
      `本次支付比当前应付多 ${formatMoney({ currency: asCurrencyCode(currency), amountMinor: overAmount }, "zh-CN")}，保存后可能产生新的反向余额`,
      409,
      {
        currentPayableMinor: currentPayable.toString(),
        overAmountMinor: overAmount.toString(),
      },
    );
  }

  /** 收款人可能是无账号临时成员；这类账务身份没有应用内通知接收地址。 */
  private async createReceiverNotification(
    transaction: postgres.TransactionSql,
    actorUserId: string,
    settlementId: string,
    receiverMemberId: string,
    amountMinor: string,
    currency: string,
  ): Promise<void> {
    const [receiver] = await transaction<{ user_id: string | null }[]>`
      select user_id from activity_members where id = ${receiverMemberId}`;
    if (!receiver?.user_id || receiver.user_id === actorUserId) return;
    await this.notifications.create(transaction, {
      recipientUserId: receiver.user_id,
      type: "SETTLEMENT_RECEIVED",
      targetType: "SETTLEMENT",
      targetId: settlementId,
      payload: { amountMinor, currency },
    });
  }
}

/** 仅在付款方实际欠款且收款方实际应收时形成该方向可抵扣金额。 */
function payableFromTo(
  balances: readonly LedgerBalance[],
  payerMemberId: string,
  receiverMemberId: string,
): bigint {
  const payer =
    balances.find((row) => row.memberId === payerMemberId)?.netMinor ?? 0n;
  const receiver =
    balances.find((row) => row.memberId === receiverMemberId)?.netMinor ?? 0n;
  return payer < 0n && receiver > 0n
    ? -payer < receiver
      ? -payer
      : receiver
    : 0n;
}
