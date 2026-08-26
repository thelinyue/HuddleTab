import type postgres from "postgres";

import { calculateLedger } from "@/domain/ledger/ledger";
import type { ActivityLedgerDto } from "@/features/settlements/contracts";
import { authorizeActivityOperation } from "@/server/permissions/authorize-activity-operation";
import { LedgerRepository } from "@/server/repositories/ledger-repository";

/**
 * 总账服务在同一可重复读快照中加载事实并调用纯 Domain 计算。余额没有数据库表，
 * 每次读取都由当前未删除事实推导，因此不会出现客户端或后台直接改写余额的入口。
 */
export class LedgerService {
  private readonly repository = new LedgerRepository();

  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async getBalances(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
  ): Promise<ActivityLedgerDto> {
    return this.sql.begin(async (transaction) => {
      await transaction`set transaction isolation level repeatable read, read only`;
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "LEDGER_READ",
      });
      const balances = calculateLedger(
        await this.repository.loadFacts(transaction, activityId),
      );
      return {
        activityId,
        currency: authorization.activity.baseCurrency,
        revision: authorization.activity.revision.toString(),
        balances: balances.map((row) => ({
          memberId: row.memberId,
          netMinor: row.netMinor.toString(),
        })),
      };
    });
  }
}
