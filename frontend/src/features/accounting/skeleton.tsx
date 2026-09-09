/** 占位与真实区域共用尺寸；未知金额不渲染成零，也不提前宣告结清。 */
export function AccountingSkeleton({ kind = "feed", section = false }: { kind?: "feed" | "settlement"; section?: boolean }) {
  return <div className={section ? "accounting-skeleton" : "workspace-page accounting-skeleton"} aria-busy="true" role="status" aria-label={kind === "feed" ? "正在读取流水…" : "正在读取结算…"}>
    <div aria-hidden="true">
      {!section ? <div className="accounting-skeleton__summary"><i /><i /><i /></div> : null}
      <div className="accounting-skeleton__heading"><i /></div>
      {[0, 1, 2].map(index => <div className="accounting-skeleton__row" key={index}><i /><span><i /><i /></span><i /></div>)}
    </div>
  </div>;
}
