"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";

export interface ActivitySummaryData {
  readonly activityName: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly memberCount: number;
  readonly totalExpenseMinor: string;
  readonly currency: string;
  readonly currentUserBalanceMinor: string;
  readonly originalCurrencyTotals: readonly { readonly currency: string; readonly amountMinor: string }[];
  readonly balances: readonly { readonly memberId: string; readonly displayName: string; readonly netMinor: string }[];
  readonly recommendations: readonly { readonly payerMemberId: string; readonly receiverMemberId: string; readonly amountMinor: string }[];
  readonly categoryTotals: readonly { readonly category: string; readonly amountMinor: string }[];
}

function money(currency: string, amountMinor: string) {
  return formatMoney(
    { currency: asCurrencyCode(currency), amountMinor: BigInt(amountMinor) },
    "zh-CN",
  );
}

function toShareText(data: ActivitySummaryData) {
  const names = new Map(data.balances.map((item) => [item.memberId, item.displayName]));
  return [
    data.activityName,
    `成员 ${data.memberCount} 人`,
    `总支出 ${money(data.currency, data.totalExpenseMinor)}`,
    `我的余额 ${money(data.currency, data.currentUserBalanceMinor)}`,
    "推荐结算：",
    ...(data.recommendations.length
      ? data.recommendations.map(
          (item) => `${names.get(item.payerMemberId) ?? "成员"} 向 ${names.get(item.receiverMemberId) ?? "成员"} 支付 ${money(data.currency, item.amountMinor)}`,
        )
      : ["当前无需推荐转账。"]),
  ].join("\n");
}

/** 结算摘要只使用服务端已经授权的账务事实，复制和分享不包含邮箱、附件或审计数据。 */
export function ActivitySummaryPage({ data }: { readonly data: ActivitySummaryData }) {
  const [notice, setNotice] = useState<string | null>(null);
  const text = useMemo(() => toShareText(data), [data]);
  const names = useMemo(
    () => new Map(data.balances.map((item) => [item.memberId, item.displayName])),
    [data.balances],
  );
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setNotice("摘要已复制。");
  };
  const share = async () => {
    if (!navigator.share) return copy();
    await navigator.share({ title: `${data.activityName}结算摘要`, text });
  };
  return (
    <section className="py-5">
      <header className="flex items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-sm text-muted-foreground">{data.activityName}</p>
          <h1 className="mt-1 text-2xl font-bold">结算摘要</h1>
          <p className="mt-1 text-sm text-muted-foreground">{data.memberCount} 人 · 总支出 {money(data.currency, data.totalExpenseMinor)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" aria-label="复制摘要" onClick={() => void copy()}><Copy aria-hidden="true" /></Button>
          <Button variant="outline" size="icon" aria-label="分享摘要" onClick={() => void share()}><Share2 aria-hidden="true" /></Button>
        </div>
      </header>
      {notice ? <p role="status" className="mt-3 text-sm text-primary">{notice}</p> : null}
      <section className="mt-6" aria-labelledby="summary-balance">
        <h2 id="summary-balance" className="text-base font-semibold">余额</h2>
        <p className="money mt-2 text-xl font-semibold">我的余额 {money(data.currency, data.currentUserBalanceMinor)}</p>
        <ul className="mt-3 divide-y border-y">
          {data.balances.map((item) => <li key={item.memberId} className="flex min-h-11 items-center justify-between gap-3 py-2"><span>{item.displayName}</span><strong className="money">{money(data.currency, item.netMinor)}</strong></li>)}
        </ul>
      </section>
      <section className="mt-6" aria-labelledby="summary-recommendation">
        <h2 id="summary-recommendation" className="text-base font-semibold">推荐结算</h2>
        {data.recommendations.length ? <ul className="mt-3 divide-y border-y">{data.recommendations.map((item) => <li key={`${item.payerMemberId}-${item.receiverMemberId}`} className="py-3 text-sm">{names.get(item.payerMemberId) ?? "成员"} 向 {names.get(item.receiverMemberId) ?? "成员"} 支付 <strong className="money">{money(data.currency, item.amountMinor)}</strong></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">当前无需推荐转账。</p>}
      </section>
    </section>
  );
}

export function ActivitySummaryLoader({ activityId }: { readonly activityId: string }) {
  const [data, setData] = useState<ActivitySummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetch(`/api/activities/${encodeURIComponent(activityId)}/summary`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { data?: ActivitySummaryData; error?: { message?: string } };
        if (!response.ok || !body.data) throw new Error(body.error?.message ?? "结算摘要加载失败，请稍后重试。");
        return body.data;
      })
      .then(setData)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "结算摘要加载失败，请稍后重试。"));
  }, [activityId]);
  if (error) return <p role="alert" className="py-8 text-destructive">{error}</p>;
  if (!data) return <p className="py-8 text-muted-foreground">正在加载结算摘要…</p>;
  return <ActivitySummaryPage data={data} />;
}
