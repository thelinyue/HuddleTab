import { ArrowLeft, CalendarDays, ChevronDown, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, LoadingState } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";
import { useSessionQuery } from "../auth/api";
import { memberName } from "../accounting/shared";
import { exportReceiptCard } from "./image-export";
import { receiptDate, receiptDayLabel, receiptTime, groupReceiptExpenses, type ReceiptDateGroup, useReceiptDataQuery } from "./receipt";
import type { Activity } from "../activities/api";
import type { ActivityMember } from "../activities/api";
import type { ExpenseAggregate } from "../accounting/api";

const splitLabels: Record<string, string> = { EQUAL: "均摊", EXACT: "按金额", PERCENTAGE: "按比例", WEIGHT: "按份数" };

/** 热敏小票卡片：预览、长图导出和系统分享共用同一份 DOM，避免换行结果不一致。 */
function ReceiptCard({ activity, members, groups }: { activity: Activity; members: ActivityMember[]; groups: ReceiptDateGroup[] }) {
  const expenses = groups.flatMap(group => group.expenses);
  const total = expenses.reduce((sum, item) => sum + BigInt(item.expense.baseAmountMinor), 0n).toString();
  return <article id="expense-receipt-card" className="expense-receipt-card" aria-label={`${activity.name}活动流水小票`}>
    <header><p>伙记</p><h1>活动流水小票</h1><h2>{activity.name}</h2><small>{groups.length ? `已选 ${groups.length} 天` : "请选择至少一个日期"}</small></header>
    <div className="expense-receipt-card__rule" />
    {groups.length ? groups.map(group => <section className="expense-receipt-group" key={group.date}><h3>{receiptDayLabel(group)}</h3>{group.expenses.map(({ expense, payments, shares }) => <div className="expense-receipt-entry" key={expense.expenseId}>
      <div className="expense-receipt-entry__title"><strong>{expense.title}</strong><b>{formatMoney(expense.originalCurrency, expense.originalAmountMinor)}</b></div>
      <p>时间：{receiptTime(expense.occurredAt)}</p><p>付款人：{payments.map(item => memberName(item.memberId, members)).join("、") || "未知成员"}</p><p>参与人：{shares.map(item => memberName(item.memberId, members)).join("、") || "无"}</p><p>分摊方式：{splitLabels[expense.splitMode] ?? expense.splitMode ?? "未设置"}</p>
    </div>)}</section>) : <p className="expense-receipt-empty">请选择至少一个日期</p>}
    <div className="expense-receipt-card__rule" /><footer><span>流水笔数：{expenses.length} 笔</span><strong>总计：{formatMoney(activity.baseCurrency, total)}</strong><small>谢谢使用伙记</small></footer>
  </article>;
}

export function ReceiptSharePage() {
  const { activityId = "" } = useParams();
  const session = useSessionQuery();
  const query = useReceiptDataQuery(session.data?.userId ?? "", activityId);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<string>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const dates = useMemo(() => query.data ? [...new Set(query.data.expenses.map(item => receiptDate(item.expense.occurredAt)))].sort().reverse() : [], [query.data]);
  const selectionInitialized = useRef(false);
  const allDatesRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!selectionInitialized.current && dates.length) {
      selectionInitialized.current = true;
      setSelectedDates([dates[0]!]);
    }
  }, [dates]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const allSelected = dates.length > 0 && selectedDates.length === dates.length;
  const partiallySelected = selectedDates.length > 0 && !allSelected;
  useEffect(() => {
    if (allDatesRef.current) allDatesRef.current.indeterminate = partiallySelected;
  }, [partiallySelected]);
  useEffect(() => {
    if (!pickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPickerOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pickerOpen]);
  if (session.isPending || query.isPending) return <main className="share-summary-page"><LoadingState label="正在生成流水小票…" /></main>;
  if (query.error || !query.data) return <main className="share-summary-page"><section className="share-summary-message"><h1>流水分享小票</h1><p role="alert">无法读取流水，请检查网络后重试。</p><Button onClick={() => void query.refetch()}>重新加载</Button></section></main>;
  const groups = groupReceiptExpenses(query.data.expenses, selectedDates, query.data.activity.startDate);
  const hasSelection = selectedDates.length > 0;
  const selectedExpenseCount = groups.reduce((total, group) => total + group.expenses.length, 0);
  function clearExportState() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(undefined); setNotice(""); setError("");
  }
  function toggleDate(date: string) {
    setSelectedDates(current => current.includes(date) ? current.filter(item => item !== date) : [...current, date]);
    clearExportState();
  }
  function toggleAllDates() {
    setSelectedDates(allSelected ? [] : [...dates]);
    clearExportState();
  }
  async function action(delivery: "save" | "share") { const card = document.getElementById("expense-receipt-card"); if (!(card instanceof HTMLElement)) return; setExporting(true); setError(""); setNotice(""); try { const result = await exportReceiptCard({ card, width: card.offsetWidth, height: card.offsetHeight, delivery }); if (result.kind === "cancelled") return; if (result.kind === "preview") { if (preview) URL.revokeObjectURL(preview); setPreview(result.url); setNotice(result.shareFailed ? "系统分享未能打开，可长按图片保存。" : "长按图片保存，或打开原图。"); } else setNotice(result.kind === "shared" ? "小票图片已交给系统分享。" : "小票图片已开始下载。"); } catch (reason) { setError(reason instanceof Error ? `导出失败：${reason.message}` : "导出失败，请重试。"); } finally { setExporting(false); } }
    return <main className="share-summary-page expense-receipt-page"><header className="share-summary-page__header"><Link className="inline-back" to={`/activities/${encodeURIComponent(activityId)}`}><ArrowLeft size={18} aria-hidden="true" />返回流水</Link><h1>流水分享小票</h1></header><div className="expense-receipt-controls"><div className="expense-receipt-selection"><button className="expense-receipt-selection-trigger" type="button" aria-expanded={pickerOpen} aria-haspopup="dialog" onClick={() => setPickerOpen(current => !current)}><span className="expense-receipt-selection-icon"><CalendarDays size={17} aria-hidden="true" /></span><span><strong>流水日期</strong><small>{hasSelection ? `已选 ${selectedDates.length} 天 · ${selectedExpenseCount} 笔流水` : "未选择日期"}</small></span><ChevronDown className={pickerOpen ? "is-open" : ""} size={18} aria-hidden="true" /></button>{pickerOpen ? <><button className="expense-receipt-picker-backdrop" type="button" aria-label="关闭日期选择" onClick={() => setPickerOpen(false)} /><div className="expense-receipt-picker" role="dialog" aria-label="选择流水日期"><header><div><strong>选择流水日期</strong><small>已选 {selectedDates.length} / {dates.length} 天</small></div><button type="button" aria-label="关闭日期选择" onClick={() => setPickerOpen(false)}><X size={18} aria-hidden="true" /></button></header><label className="expense-receipt-picker-all"><input ref={allDatesRef} type="checkbox" checked={allSelected} onChange={toggleAllDates} disabled={!dates.length} /><span><strong>全部流水</strong><small>{dates.length ? `${dates.length} 天 · ${query.data.expenses.length} 笔` : "暂无流水"}</small></span></label><div className="expense-receipt-picker-divider" /><div className="expense-receipt-picker-list" aria-label="可选日期">{dates.length ? dates.map(date => { const group = groupReceiptExpenses(query.data!.expenses, [date], query.data!.activity.startDate)[0]!; return <label key={date}><input type="checkbox" checked={selectedDates.includes(date)} onChange={() => toggleDate(date)} /><span>{receiptDayLabel(group)}</span><small>{group.expenses.length} 笔</small></label>; }) : <p>暂无可选日期</p>}</div><Button className="expense-receipt-picker-done" onClick={() => setPickerOpen(false)}>完成</Button></div></> : null}</div></div><div className="share-summary-preview expense-receipt-preview"><div style={{ visibility: preview ? "hidden" : undefined }}><ReceiptCard activity={query.data.activity} members={query.data.members} groups={groups} /></div>{preview ? <div className="share-summary-save-preview"><img src={preview} alt="流水小票 PNG 预览" /><div><a href={preview} target="_blank" rel="noreferrer">打开原图</a><Button variant="ghost" onClick={() => { URL.revokeObjectURL(preview); setPreview(undefined); }}>返回小票</Button></div></div> : null}</div><div className="share-summary-toolbar"><div className="share-summary-actions"><Button variant="secondary" disabled={exporting || Boolean(preview) || !hasSelection} onClick={() => void action("share")}>分享图片</Button><Button busy={exporting} disabled={Boolean(preview) || !hasSelection} onClick={() => void action("save")}>保存图片</Button></div></div>{notice || error ? <div className={`share-summary-feedback${error ? " share-summary-feedback--error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</div> : null}</main>;
}

