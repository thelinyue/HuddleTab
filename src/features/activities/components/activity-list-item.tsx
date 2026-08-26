import Link from "next/link";

import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import type { ActivityHomeItem } from "@/features/activities/api";

function balanceLabel(item: ActivityHomeItem) {
  const amount = BigInt(item.myNetMinor);
  if (amount === 0n) return "已结清";
  const money = formatMoney(
    {
      currency: asCurrencyCode(item.baseCurrency ?? "CNY"),
      amountMinor: amount < 0n ? -amount : amount,
    },
    "zh-CN",
  );
  return `${amount < 0n ? "应付" : "应收"} ${money}`;
}

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
  return (
    <Link
      href={`/activities/${item.id}`}
      className="block min-h-20 border-b py-3 transition-colors hover:bg-muted/60 focus-visible:rounded-md"
    >
      <div className="flex items-start justify-between gap-4">
        <strong className="min-w-0 [overflow-wrap:anywhere] text-base">
          {item.name}
        </strong>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {balanceLabel(item)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {[
          placeAndDate,
          item.memberCount ? `${item.memberCount} 人` : null,
          statusLabel[item.status],
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </Link>
  );
}
