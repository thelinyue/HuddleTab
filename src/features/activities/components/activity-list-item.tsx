import Link from "next/link";

import type { ActivityHomeItem } from "@/features/activities/api";
import { ActivityCover } from "@/components/design-system/activity-cover";
import { MoneyAmount } from "@/components/design-system/money-amount";
import { inclusiveCalendarDays } from "@/lib/calendar-date";

const statusLabel = {
  ACTIVE: "进行中",
  ENDED: "已结束",
  ARCHIVED: "已归档",
} as const;

/**
 * 列表优先显示活动持续天数，避免完整日期在窄屏重复换行。直接计算公历日序并包含首尾
 * 两天；历史数据缺少结束日期或日期无效时，继续回退到地点与开始日期。
 */
function activityPeriodLabel(item: ActivityHomeItem): string {
  const dayCount = inclusiveCalendarDays(item.startDate, item.endDate);
  if (dayCount !== null) return `${dayCount}天`;

  return [item.location, item.startDate].filter(Boolean).join(" · ");
}

/** 列表项只呈现可扫描的活动元数据和服务器计算的本人净额，不嵌套重型卡片。 */
export function ActivityListItem({
  item,
}: {
  readonly item: ActivityHomeItem;
}) {
  const periodLabel = activityPeriodLabel(item);
  const balance = BigInt(item.myNetMinor);
  const balanceTone =
    balance < 0n ? "payable" : balance > 0n ? "receivable" : "settled";
  const balanceLabel = balance < 0n ? "应付" : balance > 0n ? "应收" : "已结清";
  return (
    <Link
      href={`/activities/${item.id}`}
      className="group block min-h-[4.5rem] rounded-lg border bg-surface px-2.5 py-2 transition-colors hover:bg-surface-muted focus-visible:outline-offset-2"
    >
      <div className="flex items-center justify-between gap-2.5">
        <ActivityCover
          activityId={item.id}
          activityName={item.name}
          className="w-[4.5rem] shrink-0 rounded-md"
        />
        <div className="min-w-0 flex-1">
          <strong className="block min-w-0 truncate text-sm font-semibold">
            {item.name}
          </strong>
          <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">
            {[
              periodLabel,
              item.memberCount ? `${item.memberCount}人` : null,
              statusLabel[item.status],
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="max-w-20 shrink-0 text-right">
          <span className="block text-[11px] leading-4 text-muted-foreground">
            {balanceLabel}
          </span>
          {balance !== 0n ? (
            <MoneyAmount
              currency={item.baseCurrency ?? "CNY"}
              amountMinor={balance < 0n ? -balance : balance}
              tone={balanceTone}
              size="sm"
              className="font-medium"
            />
          ) : null}
        </div>
      </div>
    </Link>
  );
}
