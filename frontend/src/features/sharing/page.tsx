import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, LoadingState } from '../../components/ui';
import { formatMoney } from '../../domain-preview/money';
import { useSessionQuery } from '../auth/api';
import { useActivitySummaryQuery, type ShareSummary } from './adapter';
import { ShareSummaryCard } from './card';
import { exportSummaryCard } from './image-export';
import { paginateSummary, summaryItems, type SummaryItem } from './pagination';

export function summaryText(summary: ShareSummary): string {
  return [summary.activityName, `活动日期：${summary.startDate}${summary.endDate ? ` 至 ${summary.endDate}` : ''}`,
    `${summary.memberCount} 人 · ${summary.expenseCount} 笔账单 · 总支出 ${formatMoney(summary.currency, summary.totalExpenseMinor)} · 人均 ${formatMoney(summary.currency, summary.averageExpenseMinor)}`,
    '推荐转账：', ...(summary.recommendations.length ? summary.recommendations.map(item => `${item.payerName} 向 ${item.receiverName} 支付 ${formatMoney(summary.currency, item.amountMinor)}`) : ['当前无需推荐转账。']),
    '成员余额：', ...summary.balances.map(item => `${item.displayName} ${item.state === 'receivable' ? '应收' : item.state === 'payable' ? '应付' : '已结清'} ${formatMoney(summary.currency, item.amountMinor)}`),
  ].join('\n');
}

/** 独立预览区域占满剩余视口；先测量真实换行，再分页，导出直接捕获可见卡片。 */
function SummaryPreview({ summary, activityId }: { summary: ShareSummary; activityId: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const measurement = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | undefined>(undefined);
  const [pages, setPages] = useState<SummaryItem[][]>(() => [summaryItems(summary)]);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string>();
  const previewUrl = useRef<string | undefined>(undefined);
  function replacePreview(url?: string) { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = url; setPreview(url); }
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  useLayoutEffect(() => {
    let active = true;
    const measure = () => {
      if (!active || !stage.current || !measurement.current) return;
      const card = measurement.current.querySelector<HTMLElement>('.share-summary-card');
      const body = card?.querySelector<HTMLElement>('.share-card-body');
      if (!card || !body || !stage.current.clientHeight) return;
      const heights = new Map([...body.querySelectorAll<HTMLElement>('[data-summary-row]')].map(row => [row.dataset.summaryRow!, row.getBoundingClientRect().height]));
      const heading = body.querySelector<HTMLElement>('.share-card-section-heading');
      const emptyHeight = [...body.querySelectorAll<HTMLElement>('.share-card-empty')].reduce((sum, node) => sum + node.getBoundingClientRect().height, 0);
      const available = stage.current.clientHeight - (card.getBoundingClientRect().height - body.getBoundingClientRect().height) - emptyHeight - 2;
      const next = paginateSummary(summaryItems(summary), heights, available, heading?.getBoundingClientRect().height ?? 28);
      const nextPage = Math.max(0, next.findIndex(items => items.some(item => item.key === anchor.current)));
      setPages(next); setPage(nextPage);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    if (stage.current) observer?.observe(stage.current);
    if (measurement.current) observer?.observe(measurement.current);
    window.visualViewport?.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    return () => { active = false; observer?.disconnect(); window.visualViewport?.removeEventListener('resize', measure); };
  }, [summary]);
  async function imageAction(delivery: 'save' | 'share') {
    const card = document.getElementById('share-summary-preview-card');
    if (!(card instanceof HTMLElement)) return;
    setExporting(true); setError(''); setNotice('');
    try {
      const result = await exportSummaryCard({ card, width: card.offsetWidth, height: card.offsetHeight, page: page + 1, delivery });
      if (result.kind === 'cancelled') return;
      if (result.kind === 'preview') { replacePreview(result.url); setNotice('长按图片保存，或打开原图。'); if (result.shareFailed) setError('系统分享未能打开，可长按图片保存。'); }
      else { replacePreview(); setNotice(result.kind === 'shared' ? '本页图片已交给系统分享。' : '本页图片已开始下载。'); }
    } catch (reason) { setError(reason instanceof Error ? `导出失败：${reason.message}` : '导出失败，请重试。'); }
    finally { setExporting(false); }
  }
  async function copy() {
    setError('');
    try { await navigator.clipboard.writeText(summaryText(summary)); setNotice('完整摘要已复制。'); } catch { setError('复制失败，请检查浏览器权限后重试。'); }
  }
  function turn(next: number) { anchor.current = pages[next]?.[0]?.key; setPage(next); replacePreview(); setNotice(''); setError(''); }
  return <main className="share-summary-page">
    <header className="share-summary-page__header"><Link className="inline-back" to={`/activities/${encodeURIComponent(activityId)}?tab=settlement`}><ArrowLeft size={18} aria-hidden="true" />返回结算</Link><h1>结算分享摘要</h1></header>
    <div className="share-summary-preview" ref={stage}>
      <div style={{ visibility: preview ? 'hidden' : undefined }}><ShareSummaryCard summary={summary} items={pages[page] ?? []} page={page + 1} pageCount={pages.length} /></div>
      {preview ? <div className="share-summary-save-preview"><img src={preview} alt={`${summary.activityName}结算摘要 PNG 预览`} /><div><a href={preview} target="_blank" rel="noreferrer">打开原图</a><Button variant="ghost" onClick={() => replacePreview()}>返回摘要</Button></div></div> : null}
    </div>
    <div className="share-summary-toolbar">
      <div className="share-summary-pagination">{pages.length > 1 ? <><Button variant="ghost" aria-label="上一页" disabled={page === 0 || exporting} onClick={() => turn(page - 1)}><ChevronLeft size={18} /></Button><span aria-live="polite">{page + 1} / {pages.length}</span><Button variant="ghost" aria-label="下一页" disabled={page === pages.length - 1 || exporting} onClick={() => turn(page + 1)}><ChevronRight size={18} /></Button></> : <span>可直接截图分享到群聊</span>}</div>
      <div className="share-summary-actions"><Button variant="secondary" disabled={exporting} onClick={() => void copy()}>复制完整摘要</Button><Button variant="secondary" disabled={exporting || Boolean(preview)} onClick={() => void imageAction('share')}>分享本页图片</Button><Button busy={exporting} disabled={Boolean(preview)} onClick={() => void imageAction('save')}>保存本页图片</Button></div>
    </div>
    {notice || error ? <div className={`share-summary-feedback${error ? ' share-summary-feedback--error' : ''}`} role={error ? 'alert' : 'status'} onClick={() => { setNotice(''); setError(''); }}>{error || notice}</div> : null}
    <div className="share-summary-measure" ref={measurement} aria-hidden="true"><ShareSummaryCard id="share-summary-measure-card" summary={summary} /></div>
  </main>;
}

export function ShareSummaryPage() {
  const { activityId = '' } = useParams();
  const session = useSessionQuery();
  const summary = useActivitySummaryQuery(session.data?.userId ?? '', activityId);
  if (session.isPending || summary.isPending) return <main className="share-summary-page"><LoadingState label="正在生成结算摘要…" /></main>;
  if (summary.error || !summary.data) return <main className="share-summary-page"><section className="share-summary-message"><h1>结算分享摘要</h1><p role="alert">无法读取结算摘要，请检查网络后重试。</p><Button onClick={() => void summary.refetch()}>重新加载</Button></section></main>;
  return <SummaryPreview key={activityId} summary={summary.data} activityId={activityId} />;
}
