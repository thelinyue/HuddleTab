import { ArrowLeft, ImageDown } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, LoadingState } from "../../components/ui";
import { useSessionQuery } from "../auth/api";
import { useActivitySummaryQuery } from "./adapter";
import { ShareSummaryCard } from "./card";
import { exportSummaryCard } from "./image-export";

export function ShareSummaryPage() {
  const { activityId = "" } = useParams();
  const session = useSessionQuery();
  const summary = useActivitySummaryQuery(session.data?.userId ?? "", activityId);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();

  async function downloadImage() {
    setExportError(undefined);
    setExporting(true);
    try {
      await exportSummaryCard();
    } catch (error) {
      setExportError(error instanceof Error ? `导出图片失败：${error.message}` : "导出图片失败，请刷新页面后重试。");
    } finally {
      setExporting(false);
    }
  }

  if (session.isPending || summary.isPending) return <main className="share-summary-page"><LoadingState label="正在生成结算摘要…" /></main>;
  if (summary.error || !summary.data) return <main className="share-summary-page"><section className="share-summary-message"><h1>结算分享摘要</h1><p role="alert">无法读取结算摘要，请检查网络后重试。</p><Button onClick={() => void summary.refetch()}>重新加载</Button></section></main>;
  return (
    <main className="share-summary-page">
      <header className="share-summary-page__header"><Link className="inline-back" to={`/activities/${encodeURIComponent(activityId)}?tab=settlement`}><ArrowLeft aria-hidden="true" size={18} />返回结算</Link><h1>结算分享摘要</h1><p>生成一张清晰的结算图片，方便发到群里确认。</p></header>
      <section className="share-summary-preview" aria-label="结算摘要预览"><ShareSummaryCard summary={summary.data} /></section>
      <div className="share-summary-actions"><Button busy={exporting} onClick={() => void downloadImage()}><ImageDown aria-hidden="true" size={18} />{exporting ? "正在生成图片…" : "下载 PNG"}</Button></div>
      {exportError ? <p className="notice notice--error" role="alert">{exportError}</p> : null}
      <div className="share-summary-export-canvas" aria-hidden="true"><ShareSummaryCard id="share-summary-card" summary={summary.data} /></div>
    </main>
  );
}
