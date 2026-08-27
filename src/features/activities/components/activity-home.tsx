"use client";

import { useEffect, useState } from "react";

import { PlusIcon } from "lucide-react";
import {
  getActivityHome,
  type ActivityHomeDto,
  type ActivityHomeItem,
} from "@/features/activities/api";
import { ActivityListItem } from "@/features/activities/components/activity-list-item";
import { CreateActivityForm } from "@/features/activities/components/create-activity-form";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import { AppHeader } from "@/components/design-system/app-header";
import { EmptyState } from "@/components/design-system/empty-state";
import {
  ListReveal,
  ListRevealItem,
} from "@/components/design-system/list-reveal";
import { MoneyAmount } from "@/components/design-system/money-amount";
import { Button } from "@/components/ui/button";

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
      <ListReveal className="mt-2">
        {items.map((item) => (
          <ListRevealItem key={item.id}>
            <ActivityListItem item={item} />
          </ListRevealItem>
        ))}
      </ListReveal>
    </section>
  );
}

/** 首页只格式化服务器返回的汇总；跨活动应收、应付保留为两个独立数字。 */
export function ActivityHome({ data }: { readonly data: ActivityHomeDto }) {
  const [creating, setCreating] = useState(false);
  const hasActivities =
    data.active.length + data.ended.length + data.archived.length > 0;
  return (
    <>
      <AppHeader
        eyebrow="一起花，清楚分。"
        title="活动"
        actions={
          hasActivities ? (
            <Button
              size="icon"
              aria-label="创建活动"
              onClick={() => setCreating(true)}
            >
              <PlusIcon aria-hidden="true" />
            </Button>
          ) : undefined
        }
      />
      <ResponsiveFormOverlay
        open={creating}
        onOpenChange={setCreating}
        title="创建活动"
      >
        <CreateActivityForm />
      </ResponsiveFormOverlay>
      <section
        aria-label="跨活动账务摘要"
        className="mt-5 grid grid-cols-2 gap-3"
      >
        {data.summaries.flatMap((summary) => {
          return [
            <p key={`${summary.currency}-payable`} className="bg-orange/10 p-3">
              <span className="block text-sm text-muted-foreground">
                待支付
              </span>
              <MoneyAmount
                currency={summary.currency}
                amountMinor={BigInt(summary.payableMinor)}
                tone="payable"
                size="lg"
              />
            </p>,
            <p
              key={`${summary.currency}-receivable`}
              className="bg-primary/10 p-3"
            >
              <span className="block text-sm text-muted-foreground">
                待收款
              </span>
              <MoneyAmount
                currency={summary.currency}
                amountMinor={BigInt(summary.receivableMinor)}
                tone="receivable"
                size="lg"
              />
            </p>,
          ];
        })}
      </section>
      {!hasActivities && (
        <EmptyState
          icon={PlusIcon}
          title="还没有活动"
          description="创建第一个活动后，就可以开始记录消费。"
          action={<Button onClick={() => setCreating(true)}>创建活动</Button>}
        />
      )}
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
