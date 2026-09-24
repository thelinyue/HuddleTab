import { ArrowRight, Bell, CalendarDays, ChevronDown, ChevronRight, Link as LinkIcon, Plus } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { DayPicker } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { formatMoney } from "../../domain-preview/money";
import {
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Money,
  Select,
  StateIllustration,
} from "../../components/ui";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { Overlay } from "../../components/overlay";
import { useActivityLedgersQuery } from "../accounting/api";
import {
  type Activity,
  useActivitiesQuery,
  useCreateActivityMutation,
  useInvalidateActivityCoverQueries,
  uploadActivityCover,
} from "./api";
import { ACTIVITY_COVER_GROUPS, ACTIVITY_COVER_LABELS, ActivityCover, activityCoverPresetPath, type ActivityCoverPreset } from "../../components/activity-cover";
import { useSessionQuery } from "../auth/api";
import { useNotificationsQuery } from "../notifications/api";
import { activityStatus, activityPeriodLabel } from "./presentation";
import { PushPromptCard } from "../push/components";
import { ActivityCurrencySummary, type ActivitySummary } from "./activity-currency-summary";

function localCalendarToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function dateFromIso(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isoFromDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** 首页面板状态统一由 URL 驱动，便于系统返回和刷新后恢复可预测的入口层级。 */
type ActivityPanel = "actions" | "create" | "join";

function activityPanelFromSearch(value: string | null): ActivityPanel | null {
  return value === "actions" || value === "create" || value === "join" ? value : null;
}

function activityPanelDepth(state: unknown): number | null {
  if (!state || typeof state !== "object" || !("activityPanelDepth" in state)) return null;
  const depth = (state as { activityPanelDepth?: unknown }).activityPanelDepth;
  return depth === 1 || depth === 2 ? depth : null;
}

type ActivityLedgerResult = ReturnType<typeof useActivityLedgersQuery>[number];

type LedgerReadiness = "pending" | "error" | "ready";

function ledgerReadiness(ledger: ActivityLedgerResult | undefined): LedgerReadiness {
  if (!ledger || ledger.isPending) return "pending";
  if (ledger.isError || !ledger.data) return "error";
  return "ready";
}

function summarizeLedgers(activities: readonly Activity[], ledgers: ReturnType<typeof useActivityLedgersQuery>) {
  const byCurrency = new Map<string, ActivitySummary>();
  activities.forEach((activity, index) => {
    const ledger = ledgers[index];
    const readiness = ledgerReadiness(ledger);
    const current = byCurrency.get(activity.baseCurrency) ?? {
      payable: 0n,
      receivable: 0n,
      readiness: "ready" as LedgerReadiness,
    };
    if (readiness === "error") current.readiness = "error";
    else if (readiness === "pending" && current.readiness === "ready") current.readiness = "pending";
    if (readiness !== "ready") {
      byCurrency.set(activity.baseCurrency, current);
      return;
    }
    const balance = ledger.data?.balances.find((item) => item.memberId === activity.currentMemberId);
    const amount = BigInt(balance?.netMinor ?? "0");
    if (amount < 0n) current.payable += -amount;
    if (amount > 0n) current.receivable += amount;
    byCurrency.set(activity.baseCurrency, current);
  });
  return [...byCurrency.entries()];
}

function ActivityListSkeleton() {
  return (
    <div className="activity-list-skeleton" aria-hidden="true">
      <ul className="activity-list activity-list-skeleton__list">
        {[0, 1].map((index) => (
          <li className="activity-list-item activity-list-item--skeleton" key={index}>
            <span className="activity-skeleton-block activity-skeleton-block--cover" />
            <span className="activity-list-item__content">
              <span className="activity-skeleton-block activity-skeleton-block--title" />
              <span className="activity-skeleton-block activity-skeleton-block--period" />
            </span>
            <span className="activity-list-item__balance">
              <span className="activity-balance-skeleton"><i /><i /></span>
              <ChevronRight aria-hidden="true" size={16} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActivitySummarySkeleton() {
  return (
    <section className="activity-currency-summary" aria-hidden="true">
    <dl className="home-summary home-summary--skeleton" aria-hidden="true">
      {[0, 1].map((index) => (
        <div key={index}>
          <span className="activity-skeleton-block home-summary--skeleton__label" />
          <span className="activity-skeleton-block home-summary--skeleton__value" />
        </div>
      ))}
    </dl>
    </section>
  );
}

function ActivityGroup({ title, activities, allActivities, ledgers }: { title: string; activities: readonly Activity[]; allActivities: readonly Activity[]; ledgers: ReturnType<typeof useActivityLedgersQuery> }) {
  if (!activities.length) return null;
  return (
    <section className="activity-group" aria-label={title}>
      <ul className="activity-list">
        {activities.map((activity) => {
          const ledger = ledgers[allActivities.findIndex((item) => item.activityId === activity.activityId)];
          const readiness = ledgerReadiness(ledger);
          const own = readiness === "ready"
            ? ledger?.data?.balances.find((balance) => balance.memberId === activity.currentMemberId)
            : undefined;
          const amount = own ? BigInt(own.netMinor) : 0n;
          return (
            <li key={activity.activityId}>
              <Link className="activity-list-item" to={`/activities/${activity.activityId}`}>
                <ActivityCover activityId={activity.activityId} coverPreset={activity.coverPreset} coverImageId={activity.coverImageId} width={48} height={48} alt="" loading="lazy" />
                <span className="activity-list-item__content"><strong>{activity.name}</strong><small className="activity-list-item__period">{[activityPeriodLabel(activity), activityStatus(activity.status)].filter(Boolean).join(" · ")}</small></span>
                <span className="activity-list-item__balance">
                  {readiness === "pending" ? <span className="activity-balance-skeleton"><i /><i /></span> : null}
                  {readiness === "error" ? <small className="activity-list-item__balance--unavailable">余额暂不可用</small> : null}
                  {readiness === "ready" && amount === 0n ? <small>已结清</small> : null}
                  {readiness === "ready" && amount !== 0n ? <><small>{amount > 0n ? "应收" : "应付"}</small><Money value={formatMoney(activity.baseCurrency, (amount < 0n ? -amount : amount).toString())} tone={amount > 0n ? "positive" : "negative"} /></> : null}
                  <ChevronRight aria-hidden="true" size={16} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 活动列表及其 URL 驱动面板；面板切换和表单草稿仍由列表页面持有。 */
export function ActivitiesPage() {
  const session = useSessionQuery();
  const activities = useActivitiesQuery(session.data?.userId ?? "");
  const notifications = useNotificationsQuery(session.data?.userId ?? "");
  const routerLocation = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const panel = activityPanelFromSearch(searchParams.get("panel"));
  const ledgers = useActivityLedgersQuery(session.data?.userId ?? "", activities.data ?? []);
  const create = useCreateActivityMutation(session.data?.userId ?? "");
  const invalidateCoverQueries = useInvalidateActivityCoverQueries(session.data?.userId ?? "");
  const [joinToken, setJoinToken] = useState("");
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("CNY");
  const [startDate, setStartDate] = useState(localCalendarToday);
  const [endDate, setEndDate] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [dateStart, setDateStart] = useState(startDate);
  const [dateEnd, setDateEnd] = useState(endDate);
  const [dateStep, setDateStep] = useState<"start" | "end">("start");
  const [dateMonth, setDateMonth] = useState(() => dateFromIso(startDate));
  const datePickerHeadingRef = useRef<HTMLDivElement | null>(null);
  const [createError, setCreateError] = useState<unknown>();
  const [coverPreset, setCoverPreset] = useState<ActivityCoverPreset>(12);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverUploadRetry, setCoverUploadRetry] = useState<{ activityId: string; version: string; file: File } | null>(null);
  const [coverRetrying, setCoverRetrying] = useState(false);

  useEffect(() => () => {
    if (coverPreview) URL.revokeObjectURL(coverPreview);
  }, [coverPreview]);

  useEffect(() => {
    if (panel !== "create") setDateOpen(false);
  }, [panel]);

  function openDatePicker(open: boolean) {
    if (open) {
      setDateStart(startDate);
      setDateEnd(endDate);
      setDateStep("start");
      setDateMonth(dateFromIso(startDate));
    }
    setDateOpen(open);
  }

  function selectDate(day: Date) {
    const value = isoFromDate(day);
    if (dateStep === "start") {
      setDateStart(value);
      setDateEnd("");
      setDateStep("end");
    } else {
      setDateEnd(value);
      setDateStep("start");
    }
  }

  function openPanel(nextPanel: ActivityPanel) {
    const next = new URLSearchParams(searchParams);
    next.set("panel", nextPanel);
    setSearchParams(next, { state: { activityPanelDepth: nextPanel === "create" || nextPanel === "join" ? 2 : 1 } });
  }

  function closePanel() {
    setCoverPickerOpen(false);
    const depth = activityPanelDepth(routerLocation.state);
    if (depth !== null) {
      navigate(-depth);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("panel");
    setSearchParams(next, { replace: true, state: null });
  }

  function backToActions() {
    if (activityPanelDepth(routerLocation.state) === 2) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set("panel", "actions");
    setSearchParams(next, { replace: true, state: null });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setCreateError(undefined);
    try {
      const created = await create.mutateAsync({
        name,
        location: location.trim() || null,
        baseCurrency,
        startDate,
        endDate: endDate || null,
        ...(coverPreset === 12 ? {} : { coverPreset }),
      });
      if (coverFile) {
        try {
          await uploadActivityCover(created.activityId, created.version, coverFile);
          await invalidateCoverQueries(created.activityId);
        } catch {
          setCoverUploadRetry({ activityId: created.activityId, version: created.version, file: coverFile });
          setCreateError(new Error("活动已创建，封面上传失败；可以重试，之后也可在活动管理中修改。"));
          return;
        }
      }
      setName("");
      setLocation("");
      setBaseCurrency("CNY");
      setStartDate(localCalendarToday());
      setEndDate("");
      setCoverPreset(12);
      setCoverFile(null);
      setCoverPreview(null);
      setCoverPickerOpen(false);
      setCoverUploadRetry(null);
      closePanel();
    } catch (error) {
      setCreateError(error);
    }
  }

  const listPending = session.isPending || activities.isPending;
  const listError = session.error ?? activities.error;
  const items = activities.data ?? [];
  const summaries = summarizeLedgers(items, ledgers);
  const selectedCurrency = summaries.find(([currency]) => currency === searchParams.get("currency"))?.[0] ?? summaries[0]?.[0] ?? "";
  const filters = [
    { value: "all", label: "全部" },
    { value: "active", label: "进行中" },
    { value: "ended", label: "已结束" },
    { value: "archived", label: "已归档" },
  ] as const;
  const selectedFilter = filters.find((filter) => filter.value === searchParams.get("status")) ?? filters[0];
  const filteredItems = items.filter((item) => item.baseCurrency === selectedCurrency &&
    (selectedFilter.value === "all" || item.status === selectedFilter.value.toUpperCase()));
  function selectCurrency(currency: string) {
    const next = new URLSearchParams(searchParams);
    next.set("currency", currency);
    setSearchParams(next, { replace: true, state: routerLocation.state });
  }
  function selectFilter(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    setSearchParams(next, { replace: true, state: routerLocation.state });
  }
  function openChildPanel(nextPanel: "create" | "join") {
    if (panel === "actions") {
      openPanel(nextPanel);
      return;
    }
    // 空活动首页的快捷按钮直接进入表单，但仍为系统返回保留“选择操作”这一历史层级。
    const actions = new URLSearchParams(searchParams);
    actions.set("panel", "actions");
    navigate({ pathname: routerLocation.pathname, search: `?${actions.toString()}` }, { state: { activityPanelDepth: 1 } });
    const create = new URLSearchParams(actions);
    create.set("panel", nextPanel);
    navigate({ pathname: routerLocation.pathname, search: `?${create.toString()}` }, { state: { activityPanelDepth: 2 } });
  }
  const openCreate = () => openChildPanel("create");
  const openJoin = () => openChildPanel("join");
  const notificationsUnreadCount = notifications.data?.unreadCount ?? 0;
  const notificationsUnreadLabel = notificationsUnreadCount > 0
    ? `通知，${notificationsUnreadCount} 条未读`
    : "通知";
  return (
    <div className="top-level-page activities-page">
      <main className="app-frame app-frame--with-nav" aria-busy={listPending}>
        {listPending ? <span className="sr-only" role="status">正在读取活动…</span> : null}
        <header className="home-header">
          <div className="home-header__title">
            <h1>活动</h1>
          </div>
          <div className="home-header__actions">
            <Link className="icon-button activity-notifications-trigger" to="/notifications" aria-label={notificationsUnreadLabel} title="通知">
              <Bell aria-hidden="true" size={20} />
              {notificationsUnreadCount > 0 ? <span className="activity-notifications-trigger__badge" aria-hidden="true" /> : null}
            </Link>
          </div>
        </header>
        <PushPromptCard userId={session.data?.userId ?? ""} />
        {!listPending && !listError && summaries.length > 0 ? <ActivityCurrencySummary summaries={summaries} currency={selectedCurrency} onSelect={selectCurrency} /> : null}
        {listPending ? <ActivitySummarySkeleton /> : null}
        <div className="activity-status-filters" role="group" aria-label="活动状态筛选">
          {filters.map((filter) => <button key={filter.value} type="button" aria-pressed={selectedFilter.value === filter.value} onClick={() => selectFilter(filter.value)}><span>{filter.label}</span></button>)}
        </div>
        {listPending ? <ActivityListSkeleton /> : null}
        {listError ? <ErrorNotice error={listError} /> : null}
        {!listPending && !listError && !items.length ? <EmptyState
          icon={<Plus size={28} />}
          visual={<StateIllustration className="activity-empty-illustration" src="/illustrations/activity-list-empty.webp" loading="eager" />}
          title="还没有活动"
          description="创建第一个活动后，就可以开始记录消费。"
          action={<div className="empty-state__actions"><Button className="activity-empty-create" onClick={openCreate}>创建活动</Button><Button className="activity-empty-join" variant="ghost" onClick={openJoin}>加入已有活动</Button></div>}
        /> : null}
        {!listPending && !listError && items.length > 0 ? (
          filteredItems.length > 0
            ? <ActivityGroup title={`${selectedFilter.label}活动`} activities={filteredItems} allActivities={items} ledgers={ledgers} />
            : <EmptyState icon={<CalendarDays size={24} />} title={`暂无${selectedFilter.label}的活动`} description="当前币种下没有符合条件的活动，可切换状态或币种。" action={<Button variant="secondary" onClick={() => selectFilter("all")}>查看全部</Button>} />
        ) : null}
      </main>
      <ProductBottomNavigation />
      <button className="activity-add-fab" type="button" aria-label="新建或加入活动" title="新建或加入活动" onClick={() => openPanel("actions")}><Plus aria-hidden="true" size={24} /></button>
      <Overlay open={panel === "actions" || panel === "create" || panel === "join"} title={panel === "create" ? "创建活动" : panel === "join" ? "加入活动" : "新建或加入活动"} onBack={panel === "create" || panel === "join" ? { label: "新建或加入活动", onClick: backToActions } : undefined} onClose={closePanel} focusKey={panel ?? "closed"} className="activity-home-overlay activity-actions-overlay">
        {panel === "actions" ? <div className="overlay-action-list">
          <button type="button" className="settings-row" data-overlay-initial-focus onClick={openCreate}><Plus aria-hidden="true" size={20} /><span><strong>创建活动</strong><small>为旅行或聚会建立新的账本</small></span><ChevronRight aria-hidden="true" size={18} /></button>
          <button type="button" className="settings-row" onClick={openJoin}><LinkIcon aria-hidden="true" size={20} /><span><strong>加入活动</strong><small>粘贴活动所有者发送的邀请口令</small></span><ChevronRight aria-hidden="true" size={18} /></button>
        </div> : null}
        {panel === "create" ? <form className="form-stack" onSubmit={submit}>
          <Field label="活动封面">
            <button type="button" className="activity-cover-create-trigger" aria-label={coverPickerOpen ? "收起封面选择" : "点击更换活动封面"} aria-expanded={coverPickerOpen} aria-controls={coverPickerOpen ? "activity-cover-picker" : undefined} onClick={() => setCoverPickerOpen((open) => !open)}>
              <span className="activity-cover-create-preview"><img src={coverPreview ?? activityCoverPresetPath(coverPreset)} alt="封面预览" width={240} height={180} /></span>
              <span className="activity-cover-create-trigger__hint">{coverPickerOpen ? "收起封面选项" : "点击预览更换"}</span>
            </button>
            {coverPickerOpen ? <div id="activity-cover-picker" className="activity-cover-picker" role="group" aria-label="选择活动封面">{ACTIVITY_COVER_GROUPS.map((group) => <div key={group.label}><small>{group.label}</small><div className="activity-cover-picker__grid">{group.presets.map((preset) => <button key={preset} type="button" className={coverPreset === preset && !coverFile ? "is-selected" : ""} aria-label={ACTIVITY_COVER_LABELS[preset]} onClick={() => { setCoverFile(null); setCoverPreview(null); setCoverPreset(preset); setCoverPickerOpen(false); }}><img src={activityCoverPresetPath(preset)} alt="" width={72} height={54} /></button>)}</div></div>)}<label className="activity-cover-upload"><span>上传自定义封面</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0] ?? null; setCoverFile(file); setCoverPreview(file ? URL.createObjectURL(file) : null); setCoverPickerOpen(false); }} /></label></div> : null}
          </Field>
          <Field label="活动名称"><Input data-overlay-initial-focus value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></Field>
          <Field label="地点（可选）"><Input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} /></Field>
          <Field label="主币种"><Select value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value)}><option value="CNY">CNY 人民币</option><option value="USD">USD 美元</option><option value="EUR">EUR 欧元</option><option value="JPY">JPY 日元</option></Select></Field>
          <div className="field">
            <span className="field__label" id="create-activity-date-label">活动日期</span>
            <Popover.Root open={dateOpen} onOpenChange={openDatePicker} modal>
              <Popover.Trigger asChild><button className="input activity-create-date-trigger" type="button" aria-labelledby="create-activity-date-label create-activity-date-value" disabled={create.isPending}>
                <span id="create-activity-date-value"><CalendarDays aria-hidden="true" size={18} />{startDate}{endDate ? ` – ${endDate}` : " 起"}</span><ChevronDown aria-hidden="true" size={17} />
              </button></Popover.Trigger>
              <Popover.Portal><Popover.Content className="management-date-popover" side="bottom" align="end" sideOffset={8} collisionPadding={12} onOpenAutoFocus={(event) => { event.preventDefault(); datePickerHeadingRef.current?.focus({ preventScroll: true }); }} onKeyDownCapture={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); openDatePicker(false); } }}>
                <div ref={datePickerHeadingRef} className="management-date-popover__heading" tabIndex={-1}>选择活动日期</div>
                <div className="management-date-popover__range" aria-live="polite">
                  <span>开始日期 <strong>{dateStart}</strong></span><span>结束日期 <strong>{dateEnd || "未设置"}</strong></span>
                </div>
                <DayPicker mode="range" locale={zhCN} month={dateMonth} onMonthChange={setDateMonth} selected={{ from: dateFromIso(dateStart), to: dateEnd ? dateFromIso(dateEnd) : undefined }} onDayClick={selectDate} disabled={dateStep === "end" ? { before: dateFromIso(dateStart) } : undefined} />
                <div className="management-date-popover__actions"><Button variant="ghost" type="button" disabled={!dateEnd} onClick={() => setDateEnd("")}>清除结束日期</Button><Button variant="secondary" type="button" onClick={() => openDatePicker(false)}>取消</Button><Button type="button" disabled={!dateStart || (Boolean(dateEnd) && dateEnd < dateStart)} onClick={() => { setStartDate(dateStart); setEndDate(dateEnd); setDateOpen(false); }}>保存</Button></div>
              </Popover.Content></Popover.Portal>
            </Popover.Root>
          </div>
          {createError ?? create.error ? <ErrorNotice error={createError ?? create.error} /> : null}
          {coverUploadRetry ? <Button type="button" variant="secondary" busy={coverRetrying} disabled={coverRetrying} onClick={async () => { if (coverRetrying) return; setCoverRetrying(true); try { await uploadActivityCover(coverUploadRetry.activityId, coverUploadRetry.version, coverUploadRetry.file); await invalidateCoverQueries(coverUploadRetry.activityId); setCoverUploadRetry(null); setCreateError(undefined); setCoverFile(null); setCoverPreview(null); setCoverPreset(12); setCoverRetrying(false); closePanel(); } catch { setCoverRetrying(false); setCreateError(new Error("封面上传仍未成功，请稍后重试。")); } }}>重试上传封面</Button> : null}
          <Button type="submit" busy={create.isPending} disabled={Boolean(coverUploadRetry)}>创建活动</Button>
        </form> : null}
        {panel === "join" ? <form className="form-stack" onSubmit={(event) => { event.preventDefault(); const token = joinToken.trim(); if (token) navigate(`/join/${encodeURIComponent(token)}`); }}>
          <Field label="邀请口令" hint="向活动所有者索取邀请口令后粘贴到这里。"><Input value={joinToken} onChange={(event) => setJoinToken(event.target.value)} autoComplete="off" autoFocus required /></Field>
          <Button type="submit">查看邀请 <ArrowRight aria-hidden="true" size={18} /></Button>
        </form> : null}
      </Overlay>
    </div>
  );
}
