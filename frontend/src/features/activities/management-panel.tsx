import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CircleStop,
  Download,
  CalendarDays,
  Check,
  LoaderCircle,
  MapPin,
  Pencil,
  RotateCcw,
  Trash2,
  UserPlus,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { type RefObject, type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, ConfirmDialog, ErrorNotice, Input, LoadingState } from "../../components/ui";
import { MemberAvatar } from "../../components/member-avatar";
import { Overlay } from "../../components/overlay";
import { isPwaStandalone } from "../../app/pwa-standalone";
import {
  type Activity,
  type UpdateActivityInput,
  exportActivityCsv,
  useActivityLifecycleMutation,
  useDeleteActivityMutation,
  useMembersQuery,
  useTransferOwnershipMutation,
  useUpdateActivityMutation,
} from "./api";
import { useWorkspace } from "./workspace-context";
import { activityStatus } from "./presentation";

const lifecycleLabels: Record<string, string> = {
  END: "结束活动",
  REOPEN: "重新开启活动",
  ARCHIVE: "归档活动",
  UNARCHIVE: "取消归档",
};

const lifecycleDescriptions: Record<string, string> = {
  END: "结束后将停止新增账单、成员和邀请，可重新开启。",
  REOPEN: "重新开启后，活动成员可以继续记录账单。",
  ARCHIVE: "归档后活动完全只读，可在历史活动中查看。",
  UNARCHIVE: "取消归档后恢复活动的可用状态。",
};

const currencyOptions = [
  ["CNY", "人民币"],
  ["USD", "美元"],
  ["EUR", "欧元"],
  ["JPY", "日元"],
] as const;

const inviteModeLabels: Record<string, string> = {
  DIRECT_JOIN: "直接加入",
  REQUIRE_APPROVAL: "需要审批",
};

const inviteModeOptions = [
  ["DIRECT_JOIN", "直接加入", "访问有效邀请后直接成为成员。"],
  ["REQUIRE_APPROVAL", "需要审批", "申请通过管理员审批后加入。"],
] as const;

type ActivityField = keyof Activity["fieldPermissions"];

type ActivityManagementView = "root" | "transfer";

type ExpandedChoice = "baseCurrency" | "inviteMode" | null;

type ManagementConfirmation = { kind: "lifecycle"; action: string } | { kind: "delete" } | null;

/**
 * 活动管理根视图保持可扫描的设置列表；资料仍然直接编辑，复杂操作切换到同一 Sheet 的子视图。
 * 每次资料更新只提交一个字段和 version，避免覆盖其他成员的并发修改。
 */
export function MorePage({
  onClose,
  closeAfterSave = false,
  onStateChange,
  view = "root",
  onViewChange,
  transferTriggerRef,
}: {
  onClose: () => void;
  closeAfterSave?: boolean;
  onStateChange?: (state: { busy: boolean; hasError: boolean }) => void;
  view?: ActivityManagementView;
  onViewChange?: (view: ActivityManagementView) => void;
  transferTriggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { session, activity, offline } = useWorkspace();
  const update = useUpdateActivityMutation(session.userId, activity.activityId);
  const lifecycle = useActivityLifecycleMutation(session.userId, activity.activityId);
  const remove = useDeleteActivityMutation(session.userId, activity.activityId);
  const transfer = useTransferOwnershipMutation(session.userId, activity.activityId);
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => ({
    name: activity.name,
    location: activity.location ?? "",
    baseCurrency: activity.baseCurrency,
    startDate: activity.startDate,
    endDate: activity.endDate ?? "",
    inviteMode: activity.inviteMode,
  }));
  const [version, setVersion] = useState(activity.version);
  const [savingField, setSavingField] = useState<ActivityField | null>(null);
  const [lastSavedField, setLastSavedField] = useState<ActivityField | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ActivityField, unknown>>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [expandedChoice, setExpandedChoice] = useState<ExpandedChoice>(null);
  const [memberId, setMemberId] = useState("");
  const [transferError, setTransferError] = useState<unknown>();
  const [confirmation, setConfirmation] = useState<ManagementConfirmation>(null);
  const [pendingLifecycleAction, setPendingLifecycleAction] = useState<string | null>(null);
  const [lifecycleActionError, setLifecycleActionError] = useState<unknown>();
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>();
  const transferPanelRef = useRef<HTMLElement | null>(null);
  const members = useMembersQuery(session.userId, activity.activityId, view === "transfer");

  const canEdit = (field: ActivityField) =>
    !offline
    && activity.fieldPermissions[field]
    && (field !== "baseCurrency" || !activity.hasAccountingRecords);
  const editingBusy = savingField !== null || update.isPending;
  const actionBusy = editingBusy || lifecycle.isPending || pendingLifecycleAction !== null || transfer.isPending || remove.isPending || deleting || exporting;
  const hasError = Object.values(fieldErrors).some(Boolean)
    || Boolean(lifecycleActionError || transferError || transfer.error || exportError || deleteError || remove.error);

  useEffect(() => {
    setVersion(activity.version);
  }, [activity.version]);

  useEffect(() => {
    onStateChange?.({ busy: actionBusy, hasError });
  }, [actionBusy, hasError, onStateChange]);

  useEffect(() => {
    if (view !== "transfer") return;
    transferPanelRef.current?.focus();
  }, [view]);

  function setDraftValue(field: ActivityField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setLastSavedField(null);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function normalizeFieldValue(field: ActivityField, value: string): string {
    return field === "location" ? value.trim() : value;
  }

  function currentFieldValue(field: ActivityField): string {
    if (field === "location") return activity.location ?? "";
    if (field === "endDate") return activity.endDate ?? "";
    return String(activity[field]);
  }

  async function saveField(field: ActivityField, rawValue: string) {
    const value = normalizeFieldValue(field, rawValue);
    setDraftValue(field, value);
    if (!canEdit(field) || editingBusy) return;
    if (value === currentFieldValue(field)) {
      if (field === "baseCurrency" || field === "inviteMode") setExpandedChoice(null);
      return;
    }

    const input: UpdateActivityInput = { version };
    if (field === "name") input.name = value;
    if (field === "location") input.location = value || null;
    if (field === "baseCurrency") input.baseCurrency = value;
    if (field === "startDate") input.startDate = value;
    if (field === "endDate") input.endDate = value || null;
    if (field === "inviteMode") input.inviteMode = value;

    setSavingField(field);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    try {
      const result = await update.mutateAsync(input);
      setVersion(result.data.version);
      setWarnings(result.warnings);
      setLastSavedField(field);
      if (field === "baseCurrency" || field === "inviteMode") setExpandedChoice(null);
    } catch (reason) {
      setFieldErrors((current) => ({ ...current, [field]: reason }));
    } finally {
      setSavingField(null);
    }
  }

  function fieldStatus(field: ActivityField, idleIcon?: ReactNode): ReactNode {
    const icon = savingField === field
      ? <LoaderCircle aria-label="正在保存" className="spinner" size={16} />
      : lastSavedField === field
        ? <Check aria-label="已保存" size={16} />
        : idleIcon;
    return <span className="management-field__status" role="status" aria-live="polite">{icon}</span>;
  }

  function fieldError(field: ActivityField): ReactNode {
    return fieldErrors[field] ? <ErrorNotice error={fieldErrors[field]} /> : null;
  }

  async function transition(action: string) {
    if (actionBusy) return;
    setPendingLifecycleAction(action);
    setLifecycleActionError(undefined);
    setOperationNotice(null);
    try {
      await lifecycle.mutateAsync({ action, version });
      setConfirmation(null);
      setOperationNotice(`${lifecycleLabels[action] ?? "活动操作"}成功。`);
    } catch (reason) {
      const detail = reason instanceof Error && reason.message ? `：${reason.message}` : "，请稍后重试。";
      setLifecycleActionError(new Error(`${lifecycleLabels[action] ?? "活动操作"}失败${detail}`));
    } finally {
      setPendingLifecycleAction(null);
    }
  }

  function requestLifecycle(action: string) {
    if (actionBusy) return;
    if (action === "END" || action === "ARCHIVE") {
      setConfirmation({ kind: "lifecycle", action });
      return;
    }
    void transition(action);
  }

  /** 导出始终在当前文档内完成，避免 standalone PWA 被 CSV 响应替换后失去返回路径。 */
  async function exportCsv() {
    if (actionBusy) return;
    setExporting(true);
    setExportError(undefined);
    setOperationNotice(null);
    try {
      const blob = await exportActivityCsv(activity.activityId);
      const file = new File([blob], "activity-export.csv", { type: blob.type || "text/csv;charset=utf-8" });
      const shareData: ShareData = { files: [file], title: "活动 CSV" };
      if (isPwaStandalone() && navigator.share && navigator.canShare?.(shareData)) {
        try {
          await navigator.share(shareData);
          setOperationNotice("CSV 已打开系统分享。");
        } catch (reason) {
          if (!(reason instanceof DOMException && reason.name === "AbortError")) throw reason;
        }
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "activity-export.csv";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setOperationNotice("CSV 已开始下载。");
      }
    } catch (reason) {
      const detail = reason instanceof Error && reason.message ? `：${reason.message}` : "，请稍后重试。";
      setExportError(new Error(`CSV 导出失败${detail}`));
    } finally {
      setExporting(false);
    }
  }

  async function confirmTransfer() {
    if (!memberId || actionBusy) return;
    setTransferError(undefined);
    try {
      await transfer.mutateAsync({ newOwnerMemberId: memberId, version });
      onClose();
    } catch (reason) {
      setTransferError(reason);
    }
  }

  function openTransfer() {
    setMemberId("");
    setTransferError(undefined);
    onViewChange?.("transfer");
  }

  async function confirmDelete() {
    if (actionBusy) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await remove.mutateAsync(version);
      navigate("/activities", { replace: true });
    } catch (reason) {
      const detail = reason instanceof Error && reason.message ? `：${reason.message}` : "，请稍后重试。";
      setDeleteError(new Error(`删除活动失败${detail}`));
    } finally {
      setDeleting(false);
    }
  }

  const currencyLabel = currencyOptions.find(([code]) => code === draft.baseCurrency)?.[1] ?? draft.baseCurrency;
  const confirmationAction = confirmation?.kind === "lifecycle" ? confirmation.action : null;
  const confirmationTitle = confirmation?.kind === "delete"
    ? "确认删除活动"
    : confirmationAction === "END"
      ? "确认结束活动"
      : "确认归档活动";
  const confirmationMessage = confirmation?.kind === "delete"
    ? "删除后活动会离开当前列表，并在服务端给出的恢复期限内允许恢复。确定继续吗？"
    : confirmationAction === "END"
      ? "活动结束后将禁止新增或修改账单、成员和邀请，但仍可查看活动并处理实际结算。确定继续吗？"
      : "归档后活动将进入只读状态，需要取消归档后才能继续处理。确定继续吗？";
  const candidates = members.data?.filter(
    (member) => member.status === "ACTIVE" && member.userId !== null && member.memberId !== activity.ownerMemberId,
  ) ?? [];

  return (
    <div className="activity-more" data-overlay-initial-focus tabIndex={-1}>
      {closeAfterSave && actionBusy ? <div className="notice" role="status">正在保存，保存完成后关闭活动管理。</div> : null}
      {offline ? <div className="notice" role="status">当前离线，活动管理需要联网后使用。</div> : null}
      {warnings.map((warning) => (
        <div className="notice" key={warning} role="status">
          {warning === "EXPENSE_BEFORE_ACTIVITY_START"
            ? "活动开始日期晚于已有账单的发生时间，请检查日期或历史账单。"
            : warning}
        </div>
      ))}
      {view === "transfer" ? <section ref={transferPanelRef} className="management-subview" aria-labelledby="activity-transfer-heading" tabIndex={-1}>
        <div className="management-subview__intro">
          <h3 id="activity-transfer-heading">选择新的活动所有者</h3>
          <p>转让后，新成员将成为活动所有者，你会变为普通成员。</p>
        </div>
        {members.isPending ? <LoadingState label="正在读取可转让成员…" /> : null}
        {members.error ? <ErrorNotice error={members.error} /> : null}
        {!members.isPending && !members.error && candidates.length ? <div className="management-member-list" role="radiogroup" aria-label="新所有者">{candidates.map((member) => <button key={member.memberId} type="button" role="radio" aria-checked={memberId === member.memberId} disabled={actionBusy} onClick={() => setMemberId(member.memberId)}><MemberAvatar memberId={member.memberId} displayName={member.displayName} avatarPreset={member.avatarPreset} size="sm" /><span>{member.displayName}</span>{memberId === member.memberId ? <Check aria-hidden="true" size={18} /> : null}</button>)}</div> : null}
        {!members.isPending && !members.error && !candidates.length ? <p className="empty-copy">暂无可转让的已绑定账号成员。</p> : null}
        {transferError ?? transfer.error ? <ErrorNotice error={transferError ?? transfer.error} /> : null}
        <div className="management-expansion__actions"><Button variant="secondary" type="button" disabled={actionBusy} onClick={() => onViewChange?.("root")}>取消</Button><Button type="button" busy={transfer.isPending} disabled={!memberId || actionBusy} onClick={() => void confirmTransfer()}>确认转让</Button></div>
      </section> : <section aria-label="活动设置">
          <div className="management-list" role="list">
            <div className="management-field" role="listitem">
              <div className="management-field__heading"><Pencil aria-hidden="true" size={17} /><span><strong>活动名称</strong></span></div>
              {canEdit("name") ? <div className="management-field__control"><Input aria-label="活动名称" value={draft.name} disabled={editingBusy} required maxLength={120} onChange={(event) => setDraftValue("name", event.target.value)} onBlur={(event) => void saveField("name", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />{fieldStatus("name")}</div> : <span className="management-field__readonly">{activity.name}</span>}
              {fieldError("name")}
            </div>
            <div className="management-field" role="listitem">
              <div className="management-field__heading"><MapPin aria-hidden="true" size={17} /><span><strong>地点</strong><small>可选</small></span></div>
              {canEdit("location") ? <div className="management-field__control"><Input aria-label="地点" value={draft.location} disabled={editingBusy} maxLength={120} onChange={(event) => setDraftValue("location", event.target.value)} onBlur={(event) => void saveField("location", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />{fieldStatus("location")}</div> : <span className="management-field__readonly">{activity.location || "未填写"}</span>}
              {fieldError("location")}
            </div>
            <div className="management-field" role="listitem">
              <div className="management-field__heading"><CalendarDays aria-hidden="true" size={17} /><span><strong>开始日期</strong></span></div>
              {canEdit("startDate") ? <div className="management-field__control"><Input className="management-date-input" aria-label="开始日期" type="date" value={draft.startDate} disabled={editingBusy} required onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* 不支持 showPicker 时仍保留原生日期编辑。 */ } }} onChange={(event) => void saveField("startDate", event.target.value)} />{fieldStatus("startDate", <CalendarDays aria-hidden="true" size={16} />)}</div> : <span className="management-field__readonly">{activity.startDate}</span>}
              {fieldError("startDate")}
            </div>
            <div className="management-field" role="listitem">
              <div className="management-field__heading"><CalendarDays aria-hidden="true" size={17} /><span><strong>结束日期</strong><small>可选</small></span></div>
              {canEdit("endDate") ? <div className="management-field__control"><Input className="management-date-input" aria-label="结束日期" type="date" min={activity.startDate} value={draft.endDate} disabled={editingBusy} onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* 不支持 showPicker 时仍保留原生日期编辑。 */ } }} onChange={(event) => void saveField("endDate", event.target.value)} />{fieldStatus("endDate", <CalendarDays aria-hidden="true" size={16} />)}</div> : <span className="management-field__readonly">{activity.endDate || "未填写"}</span>}
              {fieldError("endDate")}
            </div>
            <div className="management-field" role="listitem">
              <div className="management-field__heading"><CircleDollarSign aria-hidden="true" size={17} /><span><strong>主币种</strong>{activity.hasAccountingRecords ? <small>已有账务记录，不可修改</small> : !activity.fieldPermissions.baseCurrency ? <small>当前账号无修改权限</small> : null}</span></div>
              {canEdit("baseCurrency") ? <div className="management-field__choice"><button className="management-choice-trigger" type="button" aria-expanded={expandedChoice === "baseCurrency"} aria-controls="activity-currency-options" disabled={editingBusy} onClick={() => setExpandedChoice((current) => current === "baseCurrency" ? null : "baseCurrency")}><span>{draft.baseCurrency} {currencyLabel}</span>{fieldStatus("baseCurrency", <ChevronDown aria-hidden="true" className={expandedChoice === "baseCurrency" ? "management-field__chevron management-field__chevron--open" : "management-field__chevron"} size={18} />)}</button></div> : <><span className="management-field__readonly">{activity.baseCurrency}</span><span className="management-field__status" aria-hidden="true" /></>}
              {expandedChoice === "baseCurrency" && canEdit("baseCurrency") ? <div className="management-choice-list" id="activity-currency-options" role="radiogroup" aria-label="主币种选项">{currencyOptions.map(([code, label]) => <button key={code} type="button" role="radio" aria-checked={draft.baseCurrency === code} disabled={editingBusy} onClick={() => void saveField("baseCurrency", code)}><span><strong>{code}</strong><small>{label}</small></span>{draft.baseCurrency === code ? <Check aria-hidden="true" size={18} /> : null}</button>)}</div> : null}
              {fieldError("baseCurrency")}
            </div>
            <div className="management-field" role="listitem">
              <div className="management-field__heading"><UserPlus aria-hidden="true" size={17} /><span><strong>加入方式</strong></span></div>
              {canEdit("inviteMode") ? <div className="management-field__choice"><button className="management-choice-trigger" type="button" aria-expanded={expandedChoice === "inviteMode"} aria-controls="activity-invite-mode-options" disabled={editingBusy} onClick={() => setExpandedChoice((current) => current === "inviteMode" ? null : "inviteMode")}><span>{inviteModeLabels[draft.inviteMode] ?? draft.inviteMode}</span>{fieldStatus("inviteMode", <ChevronDown aria-hidden="true" className={expandedChoice === "inviteMode" ? "management-field__chevron management-field__chevron--open" : "management-field__chevron"} size={18} />)}</button></div> : <><span className="management-field__readonly">{inviteModeLabels[activity.inviteMode] ?? activity.inviteMode}</span><span className="management-field__status" aria-hidden="true" /></>}
              {expandedChoice === "inviteMode" && canEdit("inviteMode") ? <div className="management-choice-list" id="activity-invite-mode-options" role="radiogroup" aria-label="加入方式选项">{inviteModeOptions.map(([value, label, description]) => <button key={value} type="button" role="radio" aria-checked={draft.inviteMode === value} disabled={editingBusy} onClick={() => void saveField("inviteMode", value)}><span><strong>{label}</strong><small>{description}</small></span>{draft.inviteMode === value ? <Check aria-hidden="true" size={18} /> : null}</button>)}</div> : null}
              {fieldError("inviteMode")}
            </div>
            <div className="management-action-item" role="listitem"><button className="management-action-row management-action-row--command" type="button" aria-label="导出 CSV" disabled={actionBusy} aria-busy={exporting} aria-describedby="activity-export-description" onClick={() => void exportCsv()}><Download aria-hidden="true" size={19} /><span><strong>导出 CSV</strong><small id="activity-export-description">下载活动账务明细</small></span><span className="management-action-row__status" role="status">{exporting ? <LoaderCircle aria-label="正在准备 CSV" className="spinner" size={17} /> : null}</span></button></div>
            <div className="management-field management-field--readonly" role="listitem">
              <div className="management-field__heading"><UsersRound aria-hidden="true" size={17} /><span><strong>当前状态</strong></span></div>
              <span className="management-field__readonly">{activityStatus(activity.status)}</span>
              <span className="management-field__status" aria-hidden="true" />
            </div>
            {!offline && activity.allowedLifecycleActions.length ? activity.allowedLifecycleActions.flatMap((action) => {
              const label = lifecycleLabels[action];
              if (!label) return [];
              const icon = action === "END" ? <CircleStop aria-hidden="true" size={19} /> : action === "REOPEN" ? <RotateCcw aria-hidden="true" size={19} /> : action === "ARCHIVE" ? <Archive aria-hidden="true" size={19} /> : <ArchiveRestore aria-hidden="true" size={19} />;
              return [<div className="management-action-item" role="listitem" key={action}><button className="management-action-row management-action-row--command" type="button" disabled={actionBusy} aria-busy={pendingLifecycleAction === action} onClick={() => requestLifecycle(action)}>{icon}<span><strong>{label}</strong><small>{lifecycleDescriptions[action]}</small></span><span className="management-action-row__status" role="status">{pendingLifecycleAction === action ? <LoaderCircle aria-label={`正在${label}`} className="spinner" size={17} /> : null}</span></button></div>];
            }) : null}
            {!offline && activity.currentMemberRole === "OWNER" ? <div className="management-action-item" role="listitem"><button ref={transferTriggerRef} className="management-action-row management-action-row--navigate" type="button" disabled={actionBusy} onClick={openTransfer}><UserRoundCheck aria-hidden="true" size={19} /><span><strong>转让所有权</strong><small>选择新的活动所有者</small></span><span className="management-action-row__status"><ChevronRight aria-hidden="true" size={18} /></span></button></div> : null}
            {!offline && activity.canDelete ? <div className="management-action-item" role="listitem"><button className="management-action-row management-action-row--command management-action-row--danger" type="button" disabled={actionBusy} onClick={() => { setConfirmation({ kind: "delete" }); setDeleteError(undefined); }}><Trash2 aria-hidden="true" size={19} /><span><strong>删除活动</strong><small>活动将离开当前列表，可在恢复期限内找回</small></span><span className="management-action-row__status" role="status">{deleting ? <LoaderCircle aria-label="正在删除活动" className="spinner" size={17} /> : null}</span></button></div> : null}
          </div>
          {exporting ? <div className="notice" role="status">正在准备 CSV…</div> : null}
          {operationNotice ? <div className="notice" role="status">{operationNotice}</div> : null}
          {exportError ? <ErrorNotice error={exportError} /> : null}
          {lifecycleActionError ? <ErrorNotice error={lifecycleActionError} /> : null}
        </section>}
      <ConfirmDialog
        open={confirmation !== null}
        title={confirmationTitle}
        message={confirmationMessage}
        error={confirmation?.kind === "delete" && (deleteError ?? remove.error) ? <ErrorNotice error={deleteError ?? remove.error} /> : confirmation?.kind === "lifecycle" && lifecycleActionError ? <ErrorNotice error={lifecycleActionError} /> : undefined}
        confirmLabel={confirmation?.kind === "delete" ? "确认删除活动" : confirmationAction ? `确认${lifecycleLabels[confirmationAction]}` : "确认"}
        busy={confirmation?.kind === "delete" ? deleting || remove.isPending : pendingLifecycleAction !== null || lifecycle.isPending}
        onConfirm={() => confirmation?.kind === "delete" ? void confirmDelete() : confirmationAction ? void transition(confirmationAction) : undefined}
        onCancel={() => { if (actionBusy) return; setConfirmation(null); setDeleteError(undefined); }}
      />
    </div>
  );
}

/** 管理 Overlay 只有一个 Sheet；保存中的关闭请求会在成功后继续，失败则保留错误和草稿。 */
/** 活动管理与关闭协调保持在同一模块：保存期间延迟关闭，失败时保留面板和草稿。 */
export function ActivityManagementOverlay({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState({ busy: false, hasError: false });
  const [closeAfterSave, setCloseAfterSave] = useState(false);
  const [view, setView] = useState<ActivityManagementView>("root");
  const transferTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousView = useRef<ActivityManagementView>("root");

  useEffect(() => {
    if (view === "root" && previousView.current === "transfer") {
      transferTriggerRef.current?.focus();
    }
    previousView.current = view;
  }, [view]);

  function requestClose() {
    if (!state.busy) return true;
    setCloseAfterSave(true);
    return false;
  }

  useEffect(() => {
    if (closeAfterSave && !state.busy && !state.hasError) {
      setCloseAfterSave(false);
      onClose();
    }
  }, [closeAfterSave, onClose, state.busy, state.hasError]);

  return (
    <Overlay
      open
      title={view === "transfer" ? "转让所有权" : "活动管理"}
      onBeforeClose={requestClose}
      onClose={onClose}
      onBack={view === "transfer" ? { label: "返回活动管理", onClick: () => { if (!state.busy) setView("root"); } } : undefined}
      focusKey={`management-${view}`}
      className="activity-management-overlay"
    >
      <MorePage
        onClose={onClose}
        closeAfterSave={closeAfterSave}
        onStateChange={setState}
        view={view}
        onViewChange={setView}
        transferTriggerRef={transferTriggerRef}
      />
    </Overlay>
  );
}
