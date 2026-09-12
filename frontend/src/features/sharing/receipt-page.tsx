import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, LoadingState } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";
import { useSessionQuery } from "../auth/api";
import { memberName } from "../accounting/shared";
import { exportReceiptCard } from "./image-export";
import { receiptDate, receiptTime, useReceiptDataQuery } from "./receipt";

const splitLabels: Record<string, string> = { EQUAL: "均摊", EXACT: "按金额", PERCENTAGE: "按比例", WEIGHT: "按份数" };

/** 热敏小票卡片：预览、长图导出和系统分享共用同一份 DOM，避免换行结果不一致。 */
function ReceiptCard({ activity, members, expenses, date }: { activity: any; members: any[]; expenses: any[]; date?: string }) {
  const total = expenses.reduce((sum, item) => sum + BigInt(item.expense.baseAmountMinor), 0n).toString();
  return <article id="expense-receipt-card" className="expense-receipt-card" aria-label={`${activity.name}活动流水小票`}>
    <header><p>伙记</p><h1>活动流水小票</h1><h2>{activity.name}</h2><small>{date ?? `${activity.startDate}${activity.endDate && activity.endDate !== activity.startDate ? ` 至 ${activity.endDate}` : ""}`}</small></header>
    <div className="expense-receipt-card__rule" />
    {expenses.length ? expenses.map(({ expense, payments, shares }: any) => <section className="expense-receipt-entry" key={expense.expenseId}>
      <div className="expense-receipt-entry__title"><strong>{expense.title}</strong><b>{formatMoney(expense.originalCurrency, expense.originalAmountMinor)}</b></div>
      <p>日期：{receiptTime(expense.occurredAt)}</p><p>付款人：{payments.map((item: any) => memberName(item.memberId, members)).join("、") || "未知成员"}</p><p>参与人：{shares.map((item: any) => memberName(item.memberId, members)).join("、") || "无"}</p><p>分摊方式：{splitLabels[expense.splitMode] ?? expense.splitMode ?? "未设置"}</p>
    </section>) : <p className="expense-receipt-empty">当日暂无流水</p>}
    <div className="expense-receipt-card__rule" /><footer><span>流水笔数：{expenses.length} 笔</span><strong>总计：{formatMoney(activity.baseCurrency, total)}</strong><small>谢谢使用伙记</small></footer>
  </article>;
}

export function ReceiptSharePage() {
  const { activityId = "" } = useParams();
  const session = useSessionQuery();
  const query = useReceiptDataQuery(session.data?.userId ?? "", activityId);
  const [mode, setMode] = useState<"date" | "all">("date");
  const [date, setDate] = useState("");
  const [preview, setPreview] = useState<string>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const dates = useMemo(() => query.data ? [...new Set(query.data.expenses.map(item => receiptDate(item.expense.occurredAt)))].sort().reverse() : [], [query.data]);
  useEffect(() => { if (!date && dates[0]) setDate(dates[0]); }, [date, dates]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  if (session.isPending || query.isPending) return <main className="share-summary-page"><LoadingState label="正在生成流水小票…" /></main>;
  if (query.error || !query.data) return <main className="share-summary-page"><section className="share-summary-message"><h1>流水分享小票</h1><p role="alert">无法读取流水，请检查网络后重试。</p><Button onClick={() => void query.refetch()}>重新加载</Button></section></main>;
  const shown = mode === "all" ? query.data.expenses : query.data.expenses.filter(item => receiptDate(item.expense.occurredAt) === date);
  const shownDate = mode === "date" ? date : undefined;
  const moveDate = (direction: number) => { const index = dates.indexOf(date); setDate(dates[Math.max(0, Math.min(dates.length - 1, index - direction))] ?? date); };
  async function action(delivery: "save" | "share") { const card = document.getElementById("expense-receipt-card"); if (!(card instanceof HTMLElement)) return; setExporting(true); setError(""); setNotice(""); try { const result = await exportReceiptCard({ card, width: card.offsetWidth, height: card.offsetHeight, delivery }); if (result.kind === "cancelled") return; if (result.kind === "preview") { if (preview) URL.revokeObjectURL(preview); setPreview(result.url); setNotice(result.shareFailed ? "系统分享未能打开，可长按图片保存。" : "长按图片保存，或打开原图。"); } else setNotice(result.kind === "shared" ? "小票图片已交给系统分享。" : "小票图片已开始下载。"); } catch (reason) { setError(reason instanceof Error ? `导出失败：${reason.message}` : "导出失败，请重试。"); } finally { setExporting(false); } }
    return <main className="share-summary-page expense-receipt-page"><header className="share-summary-page__header"><Link className="inline-back" to={`/activities/${encodeURIComponent(activityId)}`}><ArrowLeft size={18} aria-hidden="true" />返回流水</Link><h1>流水分享小票</h1></header><div className="expense-receipt-controls"><div className="expense-receipt-mode" role="group" aria-label="导出范围"><button type="button" aria-pressed={mode === "date"} onClick={() => setMode("date")}>按日期</button><button type="button" aria-pressed={mode === "all"} onClick={() => setMode("all")}>全部流水</button></div>{mode === "date" ? <div className="expense-receipt-date"><Button variant="ghost" aria-label="前一天" disabled={!dates.length || dates.indexOf(date) === dates.length - 1} onClick={() => moveDate(1)}><ChevronLeft size={18} /></Button><input aria-label="选择日期" type="date" value={date} onChange={event => setDate(event.target.value)} /><Button variant="ghost" aria-label="后一天" disabled={!dates.length || dates.indexOf(date) <= 0} onClick={() => moveDate(-1)}><ChevronRight size={18} /></Button></div> : <p>全部流水 · {shown.length} 笔</p>}</div><div className="share-summary-preview expense-receipt-preview" ref={cardRef}><div style={{ visibility: preview ? "hidden" : undefined }}><ReceiptCard activity={query.data.activity} members={query.data.members} expenses={shown} date={shownDate} /></div>{preview ? <div className="share-summary-save-preview"><img src={preview} alt="流水小票 PNG 预览" /><div><a href={preview} target="_blank" rel="noreferrer">打开原图</a><Button variant="ghost" onClick={() => { URL.revokeObjectURL(preview); setPreview(undefined); }}>返回小票</Button></div></div> : null}</div><div className="share-summary-toolbar"><div className="share-summary-actions"><Button variant="secondary" disabled={exporting || Boolean(preview)} onClick={() => void action("share")}>分享图片</Button><Button busy={exporting} disabled={Boolean(preview)} onClick={() => void action("save")}>保存图片</Button></div></div>{notice || error ? <div className={`share-summary-feedback${error ? " share-summary-feedback--error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</div> : null}</main>;
}

