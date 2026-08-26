"use client";

import { useEffect, useState } from "react";

import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import {
  getActivityHome,
  type ActivityHomeDto,
  type ActivityHomeItem,
} from "@/features/activities/api";
import { ActivityListItem } from "@/features/activities/components/activity-list-item";

function ActivityGroup({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly ActivityHomeItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-8" aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-2">
        {items.map((item) => (
          <ActivityListItem key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

/** 首页只格式化服务器返回的汇总；跨活动应收、应付保留为两个独立数字。 */
export function ActivityHome({ data }: { readonly data: ActivityHomeDto }) {
  return (
    <>
      <header className="mb-8">
        <p className="text-sm text-muted-foreground">一起花，清楚分。</p>
        <h1 className="mt-1 text-3xl font-bold">活动</h1>
      </header>
      <section
        aria-label="跨活动账务摘要"
        className="grid grid-cols-2 gap-3 bg-surface-muted p-4"
      >
        {data.summaries.flatMap((summary) => {
          const currency = asCurrencyCode(summary.currency);
          return [
            <p key={`${summary.currency}-payable`}>
              <span className="block text-sm text-muted-foreground">
                待支付
              </span>
              <strong className="money text-xl">
                {formatMoney(
                  { currency, amountMinor: BigInt(summary.payableMinor) },
                  "zh-CN",
                )}
              </strong>
            </p>,
            <p key={`${summary.currency}-receivable`}>
              <span className="block text-sm text-muted-foreground">
                待收款
              </span>
              <strong className="money text-xl">
                {formatMoney(
                  { currency, amountMinor: BigInt(summary.receivableMinor) },
                  "zh-CN",
                )}
              </strong>
            </p>,
          ];
        })}
      </section>
      <ActivityGroup title="进行中" items={data.active} />
      <ActivityGroup title="最近结束" items={data.ended} />
      {data.archived.length > 0 && (
        <details className="mt-8">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary">
            查看历史活动
          </summary>
          <ActivityGroup title="历史活动" items={data.archived} />
        </details>
      )}
    </>
  );
}

/** 页面加载层只处理加载与错误状态，保持实际展示组件可由纯数据测试。 */
export function ActivityHomeLoader() {
  const [data, setData] = useState<ActivityHomeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getActivityHome()
      .then(setData)
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "活动列表加载失败，请稍后重试。",
        );
      });
  }, []);
  if (error)
    return (
      <p role="alert" className="text-destructive">
        {error}
      </p>
    );
  if (!data) return <p className="text-muted-foreground">正在加载活动…</p>;
  return <ActivityHome data={data} />;
}
