import { useState } from "react";
import { Overlay } from "../../components/overlay";
import { Button } from "../../components/ui";
import type { Settlement, SettlementPreview, SettlementScope } from "./api";
import "./settlement-dates.css";

export function settlementDateLabel(scope?: SettlementScope | null) {
  if (!scope?.dates) return "全部日期";
  return scope.dates.map(date => date.replaceAll("-", "/")).join("、");
}

/** 历史展示只使用已保存的范围，不能用当前筛选或录入日期推断账单日期。 */
export function settlementRecordDates(settlement: Settlement) {
  const dates = [...new Set(settlement.scopeDates?.length ? settlement.scopeDates : settlement.scope?.dates ?? [])].sort();
  const count = settlement.scopeExpenseIds?.length ?? 0;
  if (!dates.length) return { dates, summary: "未记录日期范围" };
  const sameYear = dates.every(date => date.slice(0, 4) === dates[0].slice(0, 4));
  const label = dates.length > 2 ? `${dates.length} 天` : dates.map(date => {
    const [year, month, day] = date.split('-');
    return `${sameYear ? '' : `${year}/`}${Number(month)}/${Number(day)}`;
  }).join('、');
  return { dates, summary: `结算 ${label} · ${count} 笔` };
}

/** 弹层内勾选只修改草稿，应用后才切换结算范围；整行可点并保留原生复选框键盘语义。 */
export function SettlementDates({ dates, options, onApply, onClose }: {
  dates: string[] | null; options: SettlementPreview["dateOptions"]; onApply: (dates: string[] | null) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => dates ?? options.map(option => option.date));
  const selected = options.filter(option => draft.includes(option.date));
  const count = selected.reduce((sum, option) => sum + option.expenseCount, 0);
  return <Overlay open title="结算日期" onClose={onClose} mobileSheet={{ maxHeight: 0.85 }} className="settlement-dates-overlay">
    <div className="settlement-date-picker">
      <p className="settlement-date-picker__hint">可选择多个日期，合并计算这些日期的结算。</p>
      <div className="settlement-date-picker__toolbar"><Button variant="ghost" onClick={() => setDraft(options.map(option => option.date))}>全选</Button><Button variant="ghost" onClick={() => setDraft([])}>清空</Button></div>
      <div className="settlement-date-picker__list" role="group" aria-label="账单日期多选">
        {options.map(option => <label className="settlement-date-option" key={option.date}>
          <input type="checkbox" checked={draft.includes(option.date)} onChange={event => setDraft(current => event.target.checked ? [...current, option.date] : current.filter(date => date !== option.date))} />
          <span>{option.date.replaceAll("-", "/")}</span><small>{option.expenseCount} 笔账单</small>
        </label>)}
        {!options.length ? <p>暂无可结算的账单日期。</p> : null}
      </div>
      <div className="settlement-date-picker__footer"><span aria-live="polite">已选 {selected.length} 天 · {count} 笔账单</span><div><Button variant="ghost" onClick={onClose}>取消</Button><Button disabled={!selected.length} onClick={() => { onApply(selected.length === options.length ? null : selected.map(option => option.date).sort()); onClose(); }}>应用日期</Button></div></div>
    </div>
  </Overlay>;
}
