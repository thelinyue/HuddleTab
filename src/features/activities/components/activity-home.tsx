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
import { JoinActivityForm } from "@/features/activities/components/join-activity-form";
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
    <section className="mt-5" aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`} className="text-sm font-semibold">
        {title}
      </h2>
      <ListReveal>
        <ul aria-label={title} className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <ListRevealItem>
                <ActivityListItem item={item} />
              </ListRevealItem>
            </li>
          ))}
        </ul>
      </ListReveal>
    </section>
  );
}

/** 首页只格式化服务器返回的汇总；跨活动应收、应付保留为两个独立数字。 */
export function ActivityHome({ data }: { readonly data: ActivityHomeDto }) {
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const hasActivities =
    data.active.length + data.ended.length + data.archived.length > 0;
  return (
    <>
      <div className="-mx-4 -mt-[calc(1rem+env(safe-area-inset-top))] -mb-[calc(5rem+env(safe-area-inset-bottom))] min-h-dvh bg-surface px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))] min-[481px]:-mx-6 min-[481px]:px-6">
        <header className="flex min-h-11 items-center justify-between">
          <h1 className="text-xl font-semibold">活动</h1>
          <Button
            size="icon"
            variant="ghost"
            className="rounded-full hover:bg-primary/8"
            aria-label="新建或加入活动"
            title="新建或加入活动"
            onClick={() => setActionsOpen(true)}
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <PlusIcon aria-hidden="true" className="size-4" />
            </span>
          </Button>
        </header>
        <ResponsiveFormOverlay
          open={creating}
          onOpenChange={setCreating}
          title="创建活动"
        >
          <CreateActivityForm />
        </ResponsiveFormOverlay>
        <ResponsiveFormOverlay
          open={actionsOpen}
          onOpenChange={setActionsOpen}
          title="新建或加入活动"
        >
          <div className="grid gap-3 pt-2">
            <Button
              type="button"
              size="lg"
              onClick={() => {
                setActionsOpen(false);
                setCreating(true);
              }}
            >
              创建活动
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => {
                setActionsOpen(false);
                setJoining(true);
              }}
            >
              加入活动
            </Button>
          </div>
        </ResponsiveFormOverlay>
        <ResponsiveFormOverlay
          open={joining}
          onOpenChange={setJoining}
          title="加入活动"
        >
          <JoinActivityForm />
        </ResponsiveFormOverlay>
        <dl aria-label="跨活动账务摘要" className="mt-3 grid grid-cols-2 gap-2">
          {data.summaries.flatMap((summary) => {
            return [
              <div
                key={`${summary.currency}-payable`}
                className="min-h-16 rounded-md bg-orange/10 px-3 py-2.5"
              >
                <dt className="text-xs text-muted-foreground">待支付</dt>
                <dd className="mt-0.5">
                  <MoneyAmount
                    currency={summary.currency}
                    amountMinor={BigInt(summary.payableMinor)}
                    tone="payable"
                    size="lg"
                  />
                </dd>
              </div>,
              <div
                key={`${summary.currency}-receivable`}
                className="min-h-16 rounded-md bg-primary/10 px-3 py-2.5"
              >
                <dt className="text-xs text-muted-foreground">待收款</dt>
                <dd className="mt-0.5">
                  <MoneyAmount
                    currency={summary.currency}
                    amountMinor={BigInt(summary.receivableMinor)}
                    tone="receivable"
                    size="lg"
                  />
                </dd>
              </div>,
            ];
          })}
        </dl>
        {!hasActivities && (
          <EmptyState
            icon={PlusIcon}
            title="还没有活动"
            description="创建第一个活动后，就可以开始记录消费。"
            action={
              <div className="grid gap-2">
                <Button onClick={() => setCreating(true)}>创建活动</Button>
                <Button variant="outline" onClick={() => setJoining(true)}>
                  加入已有活动
                </Button>
              </div>
            }
          />
        )}
        <ActivityGroup title="进行中的活动" items={data.active} />
        <ActivityGroup title="最近结束" items={data.ended} />
        {data.archived.length > 0 && (
          <details className="mt-5">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary">
              查看历史活动
            </summary>
            <ActivityGroup title="历史活动" items={data.archived} />
          </details>
        )}
      </div>
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
