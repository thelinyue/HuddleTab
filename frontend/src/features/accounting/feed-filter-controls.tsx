import { Check, ChevronDown, Filter, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MemberAvatar } from "../../components/member-avatar";
import { Overlay } from "../../components/overlay";
import { Button, Field, Input } from "../../components/ui";
import type { ActivityMember } from "../activities/api";
import { useFeedFilters } from "./feed-filter-context";
import { emptyFeedFilters, feedDateError, feedFilterCount, type FeedFilters } from "./feed-filters";
import { categories, memberName } from "./shared";
import "./feed-filters.css";

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

function MemberFilter({ label, hint, members, selected, onChange }: {
  label: string; hint: string; members: readonly ActivityMember[]; selected: string[]; onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = members.filter(member => member.displayName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <details className="feed-filter-members">
    <summary><span>{label}<small>{hint}</small></span><span>{selected.length ? `已选 ${selected.length} 人` : "全部"}</span><ChevronDown aria-hidden="true" size={16} /></summary>
    <div className="feed-filter-members__body">
      <Input aria-label={`搜索${label}`} placeholder="搜索成员姓名" value={search} onChange={event => setSearch(event.target.value)} />
      <div role="group" aria-label={label}>
        {visible.map(member => <button key={member.memberId} type="button" role="checkbox" aria-checked={selected.includes(member.memberId)} className="quick-member-row__button" onClick={() => onChange(toggle(selected, member.memberId))}>
          <MemberAvatar {...member} size="sm" decorative />
          <span>{member.displayName}{member.status === "LEFT" ? <small>已退出</small> : null}</span>
          <span className={`quick-member-row__check${selected.includes(member.memberId) ? " quick-member-row__check--selected" : ""}`}><Check aria-hidden="true" size={14} /></span>
        </button>)}
        {!visible.length ? <p className="feed-filter-muted">没有找到成员</p> : null}
      </div>
    </div>
  </details>;
}

/** 面板只修改草稿，所有关闭路径丢弃草稿；应用是唯一的提交入口。 */
function FilterDialog({ open, members, draft, setDraft, onClose, onApply }: {
  open: boolean; members: readonly ActivityMember[]; draft: FeedFilters; setDraft: (draft: FeedFilters) => void; onClose: () => void; onApply: () => void;
}) {
  const dateError = feedDateError(draft.from, draft.to);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 软键盘缩小视口时只滚动面板内部，避免输入框落到固定操作栏后面或带动背景页面。
  function revealInput(target: Element | null) {
    const scroll = scrollRef.current;
    if (!(target instanceof HTMLInputElement) || !scroll?.contains(target)) return;
    const bounds = scroll.getBoundingClientRect();
    const input = target.getBoundingClientRect();
    if (input.bottom > bounds.bottom - 8) scroll.scrollTop += input.bottom - bounds.bottom + 8;
    else if (input.top < bounds.top + 8) scroll.scrollTop -= bounds.top + 8 - input.top;
  }
  useEffect(() => {
    if (!open || !scrollRef.current) return;
    const observer = new ResizeObserver(() => revealInput(document.activeElement));
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [open]);
  return <Overlay open={open} title="筛选流水" initialFocus="mobile-dialog" mobileSheet={{ maxHeight: 0.88 }} className="feed-filter-overlay" onClose={onClose}>
    <div ref={scrollRef} className="feed-filter-scroll" onFocusCapture={event => revealInput(event.target)}>
      <p className="sr-only" tabIndex={-1} data-overlay-initial-focus>选择分类、日期、付款人和参与人</p>
      <section className="feed-filter-section" aria-label="分类">
        <h3>分类 <small>可多选</small></h3>
        <div className="feed-filter-categories">{categories.map(([value, label]) => <button type="button" key={value} aria-pressed={draft.categories.includes(value)} onClick={() => setDraft({ ...draft, categories: toggle(draft.categories, value) })}>{label}{draft.categories.includes(value) ? <Check aria-hidden="true" size={14} /> : null}</button>)}</div>
      </section>
      <section className="feed-filter-section" aria-label="消费日期">
        <header><h3>消费日期</h3>{draft.from || draft.to ? <Button variant="ghost" onClick={() => setDraft({ ...draft, from: "", to: "" })}>清空日期</Button> : null}</header>
        <div className="feed-filter-dates">
          <Field label="开始日期"><Input type="date" value={draft.from} aria-describedby="feed-date-hint" aria-invalid={Boolean(dateError)} onChange={event => setDraft({ ...draft, from: event.target.value })} /></Field>
          <Field label="结束日期"><Input type="date" value={draft.to} aria-describedby="feed-date-hint" aria-invalid={Boolean(dateError)} onChange={event => setDraft({ ...draft, to: event.target.value })} /></Field>
        </div>
        <p id="feed-date-hint" className={dateError ? "feed-filter-error" : "feed-filter-muted"}>{dateError ?? "按本地消费日期 · 含起止日"}</p>
      </section>
      <MemberFilter label="付款人" hint="实际支付账单的成员" members={members} selected={draft.payerIds} onChange={payerIds => setDraft({ ...draft, payerIds })} />
      <MemberFilter label="参与人" hint="参与分摊的成员" members={members} selected={draft.participantIds} onChange={participantIds => setDraft({ ...draft, participantIds })} />
    </div>
    <div className="feed-filter-footer"><Button variant="secondary" onClick={() => setDraft(emptyFeedFilters())}>重置</Button><Button disabled={Boolean(dateError)} onClick={onApply}>应用筛选</Button></div>
  </Overlay>;
}

/** 搜索立即反馈，IME 组词时只更新输入值；筛选条件通过独立草稿一次性应用。 */
export function FeedFilterControls({ members, count, pendingCount }: { members: readonly ActivityMember[]; count: number; pendingCount: number }) {
  const { state: { query, searchOpen, filters }, setState } = useFeedFilters();
  const [text, setText] = useState(query);
  const composing = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const focusRequested = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [dialogKey, setDialogKey] = useState(0);
  const dimensions = feedFilterCount(filters);
  const active = Boolean(query.trim() || dimensions);
  useEffect(() => { setText(query); }, [query]);
  useEffect(() => {
    if (searchOpen && focusRequested.current) {
      searchRef.current?.focus();
      focusRequested.current = false;
    }
  }, [searchOpen]);
  function clearAll() {
    setText("");
    setState(current => ({ ...current, query: "", filters: emptyFeedFilters() }));
  }
  function removeFilter(next: FeedFilters) { setState(current => ({ ...current, filters: next })); }
  const chips = [
    ...filters.categories.map(value => ({ key: `category-${value}`, label: categories.find(([key]) => key === value)?.[1] ?? value, remove: () => removeFilter({ ...filters, categories: toggle(filters.categories, value) }) })),
    ...(filters.from ? [{ key: "date", label: `${filters.from} 至 ${filters.to}`, remove: () => removeFilter({ ...filters, from: "", to: "" }) }] : []),
    ...filters.payerIds.map(id => ({ key: `payer-${id}`, label: `付款人：${memberName(id, members)}`, remove: () => removeFilter({ ...filters, payerIds: toggle(filters.payerIds, id) }) })),
    ...filters.participantIds.map(id => ({ key: `participant-${id}`, label: `参与人：${memberName(id, members)}`, remove: () => removeFilter({ ...filters, participantIds: toggle(filters.participantIds, id) }) })),
  ];
  return <>
    <header className="expense-feed-section__header">
      <h2 id="expense-feed-heading">全部流水</h2>
      <div className="expense-feed-section__actions">
        <button ref={searchTrigger} type="button" className="button button--ghost" aria-expanded={searchOpen} aria-controls="feed-search" onClick={() => {
          focusRequested.current = true;
          if (searchOpen) { searchRef.current?.focus(); focusRequested.current = false; }
          else setState(current => ({ ...current, searchOpen: true }));
        }}><Search aria-hidden="true" size={16} />搜索</button>
        <Button variant="ghost" aria-haspopup="dialog" aria-expanded={open} onClick={event => {
          // WebKit 触摸按钮不会自动聚焦；先记录入口，让 Overlay 关闭后能正确恢复焦点。
          event.currentTarget.focus({ preventScroll: true });
          setDraft(filters); setDialogKey(key => key + 1); setOpen(true);
        }}><Filter aria-hidden="true" size={16} />筛选{dimensions ? <span className="feed-filter-badge">{dimensions}</span> : null}</Button>
      </div>
    </header>
    {searchOpen ? <div id="feed-search" className="feed-search">
      <div className="feed-search__input"><Search aria-hidden="true" size={17} /><Input ref={searchRef} aria-label="搜索用途或备注" placeholder="搜索用途或备注" value={text} enterKeyHint="search"
        onChange={event => { setText(event.target.value); if (!composing.current) setState(current => ({ ...current, query: event.target.value })); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={event => { composing.current = false; const value = event.currentTarget.value; setText(value); setState(current => ({ ...current, query: value })); }}
        onKeyDown={event => { if (event.key === "Enter" && !composing.current) event.currentTarget.blur(); }}
      />{text ? <button type="button" className="icon-button" aria-label="清空搜索" onClick={() => { setText(""); setState(current => ({ ...current, query: "" })); searchRef.current?.focus(); }}><X aria-hidden="true" size={16} /></button> : null}</div>
      <Button variant="ghost" onClick={() => { setText(""); composing.current = false; setState(current => ({ ...current, query: "", searchOpen: false })); searchTrigger.current?.focus(); }}>取消</Button>
    </div> : null}
    {active ? <>
      <div className="feed-filter-chips" aria-label="已选条件">{chips.map(chip => <button type="button" key={chip.key} aria-label={`移除${chip.label}`} onClick={chip.remove}><span>{chip.label}</span><X aria-hidden="true" size={14} /></button>)}<Button variant="ghost" onClick={clearAll}>清除全部</Button></div>
      <p className="feed-filter-result" role="status">找到 {count} 笔流水{pendingCount ? ` · 本地待同步 ${pendingCount} 笔` : ""}</p>
    </> : null}
    <FilterDialog key={dialogKey} open={open} members={members} draft={draft} setDraft={setDraft} onClose={() => setOpen(false)} onApply={() => { setState(current => ({ ...current, filters: draft })); setOpen(false); }} />
  </>;
}
