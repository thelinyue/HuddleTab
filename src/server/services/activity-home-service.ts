import type postgres from "postgres";

import { calculateLedger } from "@/domain/ledger/ledger";
import type {
  ActivityHomeDto,
  ActivityHomeItem,
} from "@/features/activities/api";
import { ApplicationError } from "@/server/errors/application-error";
import { LedgerRepository } from "@/server/repositories/ledger-repository";

/**
 * 活动首页的跨活动只读投影。每个活动继续复用 Ledger 的不可变事实，而非将余额保存到
 * 活动表；应付与应收分别累加，绝不在活动之间互相抵消。
 */
export class ActivityHomeService {
  private readonly ledgerRepository = new LedgerRepository();

  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async get(session: { readonly user: { readonly id: string } } | null) {
    if (!session) {
      throw new ApplicationError(
        "UNAUTHENTICATED",
        "登录状态已失效，请重新登录。",
        401,
      );
    }
    return this.sql.begin(async (transaction): Promise<ActivityHomeDto> => {
      await transaction`set transaction isolation level repeatable read, read only`;
      const activities =
        await transaction`select activity.id, activity.name, activity.location, activity.base_currency, activity.start_date, activity.end_date, activity.status, member.id as member_id
          from activities activity
          join activity_members member on member.activity_id = activity.id
          where member.user_id = ${session.user.id} and activity.deleted_at is null
          order by activity.updated_at desc, activity.id desc`;
      const items: ActivityHomeItem[] = [];
      for (const activity of activities) {
        const facts = await this.ledgerRepository.loadFacts(
          transaction,
          activity.id,
        );
        const myNetMinor =
          calculateLedger(facts).find(
            (balance) => balance.memberId === activity.member_id,
          )?.netMinor ?? 0n;
        items.push({
          id: activity.id,
          name: activity.name,
          location: activity.location,
          baseCurrency: activity.base_currency,
          startDate: activity.start_date,
          endDate: activity.end_date,
          status: activity.status,
          memberCount: facts.memberIds.length,
          myNetMinor: myNetMinor.toString(),
        });
      }
      const totalsByCurrency = new Map<
        string,
        { payableMinor: bigint; receivableMinor: bigint }
      >();
      for (const item of items) {
        const currency = item.baseCurrency ?? "CNY";
        const current = totalsByCurrency.get(currency) ?? {
          payableMinor: 0n,
          receivableMinor: 0n,
        };
        const amount = BigInt(item.myNetMinor);
        if (amount < 0n) current.payableMinor += -amount;
        if (amount > 0n) current.receivableMinor += amount;
        totalsByCurrency.set(currency, current);
      }
      return {
        summaries: [...totalsByCurrency.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([currency, amounts]) => ({
            currency,
            payableMinor: amounts.payableMinor.toString(),
            receivableMinor: amounts.receivableMinor.toString(),
          })),
        active: items.filter((item) => item.status === "ACTIVE"),
        ended: items.filter((item) => item.status === "ENDED"),
        archived: items.filter((item) => item.status === "ARCHIVED"),
      };
    });
  }
}
