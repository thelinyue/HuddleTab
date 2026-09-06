import { ArrowLeft, Check, Copy, ImageDown, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, LoadingState, Money } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";
import { useSessionQuery } from "../auth/api";
import { useActivitySummaryQuery, type ShareSummary } from "./adapter";
import { ShareSummaryCard } from "./card";
import { exportSummaryCard } from "./image-export";

const categoryLabels: Record<string, string> = {
  FOOD: "餐饮",
  TRANSPORT: "交通",
  LODGING: "住宿",
  TICKET: "门票",
  SHOPPING: "购物",
  ENTERTAINMENT: "娱乐",
  OTHER: "其他",
};

function summaryText(summary: ShareSummary): string {
  const date = summary.endDate ? `${summary.startDate} 至 ${summary.endDate}` : summary.startDate;
  const lines = [
    summary.activityName,
    `活动日期：${date}`,
    `成员 ${summary.memberCount} 人 · 账单 ${summary.expenseCount} 笔 · 总支出 ${formatMoney(summary.currency, summary.totalExpenseMinor)}`,
    `参与成员 ${summary.participatingMemberCount} 人 · 人均 ${formatMoney(summary.currency, summary.averageExpenseMinor)}`,
    `我的余额：${formatMoney(summary.currency, summary.currentUserBalanceMinor)}`,
    "推荐结算：",
    ...(summary.recommendations.length ? summary.recommendations.map((item) => `${item.payerName} 向 ${item.receiverName} 支付 ${formatMoney(summary.currency, item.amountMinor)}`) : ["当前无需推荐转账。"]),
  ];
  if (summary.originalCurrencyTotals.length) {
    lines.push("原币种汇总：", ...summary.originalCurrencyTotals.map((item) => `${item.currency} ${formatMoney(item.currency, item.amountMinor)}`));
  }
  if (summary.categoryTotals.length) {
    lines.push("分类汇总：", ...summary.categoryTotals.map((item) => `${categoryLabels[item.category] ?? item.category} ${formatMoney(summary.currency, item.amountMinor)}`));
  }
  return lines.join("\n");
}

export function ShareSummaryPage() {
  const { activityId = "" } = useParams();
  const session = useSessionQuery();
  const summary = useActivitySummaryQuery(session.data?.userId ?? "", activityId);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>();
  const imagePreviewUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => () => {
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
  }, []);

  function replaceImagePreview(nextUrl?: string) {
    if (imagePreviewUrlRef.current && imagePreviewUrlRef.current !== nextUrl) URL.revokeObjectURL(imagePreviewUrlRef.current);
    imagePreviewUrlRef.current = nextUrl;
    setImagePreviewUrl(nextUrl);
  }

  async function downloadImage() {
    setActionError(undefined);
    setNotice(undefined);
    setExporting(true);
    try {
      const result = await exportSummaryCard();
      if (result.kind === "cancelled") return;
      if (result.kind === "preview") {
        replaceImagePreview(result.url);
        setNotice("PNG 已生成，请长按下方图片保存。");
        if (result.shareFailed) setActionError("系统分享未能打开，已改为显示 PNG 原图。");
        return;
      }
      replaceImagePreview();
      setNotice(result.kind === "shared" ? "PNG 已交给系统分享。" : "PNG 已开始下载。");
    } catch (error) {
      setActionError(error instanceof Error ? `导出图片失败：${error.message}` : "导出图片失败，请刷新页面后重试。");
    } finally {
      setExporting(false);
    }
  }

  async function copySummary() {
    if (!summary.data) return;
    setActionError(undefined);
    try {
      await navigator.clipboard.writeText(summaryText(summary.data));
      setNotice("摘要已复制。");
    } catch {
      setActionError("复制摘要失败，请检查浏览器权限后重试。");
    }
  }

  async function shareSummary() {
    if (!summary.data) return;
    setActionError(undefined);
    if (!navigator.share) {
      await copySummary();
      return;
    }
    try {
      await navigator.share({ title: `${summary.data.activityName}结算摘要`, text: summaryText(summary.data) });
      setNotice("摘要已分享。");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setActionError("系统分享失败，请稍后重试。");
    }
  }

  if (session.isPending || summary.isPending) return <main className="share-summary-page"><LoadingState label="正在生成结算摘要…" /></main>;
  if (summary.error || !summary.data) return <main className="share-summary-page"><section className="share-summary-message"><h1>结算分享摘要</h1><p role="alert">无法读取结算摘要，请检查网络后重试。</p><Button onClick={() => void summary.refetch()}>重新加载</Button></section></main>;
  return (
    <main className="share-summary-page">
      <header className="share-summary-page__header"><Link className="inline-back" to={`/activities/${encodeURIComponent(activityId)}?tab=settlement`}><ArrowLeft aria-hidden="true" size={18} />返回结算</Link><h1>结算分享摘要</h1><p>生成一张清晰的结算图片，方便发到群里确认。</p></header>
      <section className="share-summary-overview" aria-labelledby="share-summary-overview-title">
        <h2 id="share-summary-overview-title">活动概览</h2>
        <p>{summary.data.startDate}{summary.data.endDate ? ` 至 ${summary.data.endDate}` : ""} · {summary.data.expenseCount} 笔账单 · {summary.data.participatingMemberCount} 位参与成员</p>
        <div className="share-summary-overview__stats"><span><strong>总支出</strong><Money value={formatMoney(summary.data.currency, summary.data.totalExpenseMinor)} /></span><span><strong>人均</strong><Money value={formatMoney(summary.data.currency, summary.data.averageExpenseMinor)} /></span></div>
        {summary.data.originalCurrencyTotals.length ? <div><strong>原币种汇总</strong><ul>{summary.data.originalCurrencyTotals.map((item) => <li key={item.currency}>{item.currency}<Money value={formatMoney(item.currency, item.amountMinor)} /></li>)}</ul></div> : null}
        {summary.data.categoryTotals.length ? <div><strong>分类汇总</strong><ul>{summary.data.categoryTotals.map((item) => <li key={item.category}>{categoryLabels[item.category] ?? item.category}<Money value={formatMoney(summary.data.currency, item.amountMinor)} /></li>)}</ul></div> : null}
      </section>
      <section className="share-summary-preview" aria-label="结算摘要预览"><ShareSummaryCard id="share-summary-preview-card" summary={summary.data} /></section>
      {notice ? <p className="notice notice--success" role="status"><Check aria-hidden="true" size={17} />{notice}</p> : null}
      <div className="share-summary-actions"><Button variant="secondary" onClick={() => void copySummary()}><Copy aria-hidden="true" size={18} />复制摘要</Button><Button variant="secondary" onClick={() => void shareSummary()}><Share2 aria-hidden="true" size={18} />系统分享</Button><Button busy={exporting} onClick={() => void downloadImage()}><ImageDown aria-hidden="true" size={18} />{exporting ? "正在生成图片…" : "下载 PNG"}</Button></div>
      {actionError ? <p className="notice notice--error" role="alert">{actionError}</p> : null}
      {imagePreviewUrl ? <section className="share-summary-save-preview" aria-labelledby="share-summary-save-preview-title"><h2 id="share-summary-save-preview-title">保存 PNG</h2><p>长按图片即可保存；也可以打开原图后使用浏览器的分享或存储操作。</p><img src={imagePreviewUrl} alt={`${summary.data.activityName}结算摘要 PNG 预览`} /><a className="button button--secondary" href={imagePreviewUrl} target="_blank" rel="noreferrer">打开原图</a></section> : null}
      <div className="share-summary-export-canvas" aria-hidden="true"><ShareSummaryCard id="share-summary-card" summary={summary.data} /></div>
    </main>
  );
}
