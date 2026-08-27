import Link from "next/link";

import type { ActivityHomeItem } from "@/features/activities/api";
import { ActivityCover } from "@/components/design-system/activity-cover";
import { MoneyAmount } from "@/components/design-system/money-amount";

const statusLabel = {
  ACTIVE: "进行中",
  ENDED: "已结束",
  ARCHIVED: "已归档",
} as const;

/** 列表项只呈现可扫描的活动元数据和服务器计算的本人净额，不嵌套重型卡片。 */
export function ActivityListItem({
  item,
}: {
  readonly item: ActivityHomeItem;
}) {
  const placeAndDate = [item.location, item.startDate]
    .filter(Boolean)
    .join(" · ");
  const balance = BigInt(item.myNetMinor);
  const balanceTone =
    balance < 0n ? "payable" : balance > 0n ? "receivable" : "settled";
  const balanceLabel = balance < 0n ? "应付" : balance > 0n ? "应收" : "已结清";
  return (
    <Link
      href={`/activities/${item.id}`}
      className="block min-h-20 border-b py-3 transition-colors hover:bg-muted/60 focus-visible:rounded-md"
    >
      <div className="flex items-start justify-between gap-4">
        <ActivityCover
          activityId={item.id}
          activityName={item.name}
          className="mt-0.5 w-20 shrink-0 rounded-md"
        />
        <div className="min-w-0 flex-1">
          <strong className="min-w-0 [overflow-wrap:anywhere] text-base">
            {item.name}
          </strong>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              placeAndDate,
              item.memberCount ? `${item.memberCount} 人` : null,
              statusLabel[item.status],
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="block text-xs text-muted-foreground">
            {balanceLabel}
          </span>
          <MoneyAmount
            currency={item.baseCurrency ?? "CNY"}
            amountMinor={balance < 0n ? -balance : balance}
            tone={balanceTone}
            size="sm"
          />
        </div>
      </div>
    </Link>
  );
}
