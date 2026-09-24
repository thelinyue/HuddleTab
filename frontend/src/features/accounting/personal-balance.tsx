import { Money, Button, ErrorNotice } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";

/** 余额是付款、分摊与实际结算共同形成的净额；此字段只读，不承担导航。 */
export function PersonalBalance({ currency, netMinor, error, onRetry }: { currency: string; netMinor?: string; error?: unknown; onRetry: () => void }) {
  // 刷新失败时旧的零余额不能作为已结清的依据，直接展示读取失败状态。
  const net = error || netMinor === undefined ? undefined : BigInt(netMinor);
  return <div className="personal-balance" aria-label="我的结算">
    <span className="personal-balance__label">{net === undefined ? "个人余额" : net < 0n ? "我的应付" : net > 0n ? "我的应收" : "个人余额已平"}</span>
    {net !== undefined ? <Money value={formatMoney(currency, (net < 0n ? -net : net).toString())} tone={net > 0n ? "positive" : net < 0n ? "negative" : undefined} /> : !error ? <span className="accounting-skeleton personal-balance__loading" role="status" aria-label="正在读取我的结算…"><i /></span> : null}
    {error ? <div className="personal-balance__error"><ErrorNotice error={error} /><Button variant="ghost" onClick={onRetry}>重试</Button></div> : null}
  </div>;
}
