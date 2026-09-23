import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CircleStop,
  Download,
  History,
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
import { type ChangeEvent, type RefObject, type ReactNode, useEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { DayPicker } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
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
  useUpdateActivityCoverMutation,
  useUploadActivityCoverMutation,
} from "./api";
import { ACTIVITY_COVER_GROUPS, ACTIVITY_COVER_LABELS, ActivityCover, activityCoverPresetPath, type ActivityCoverPreset } from "../../components/activity-cover";
import { ActivityAuditPanel } from "./activity-audit-panel";
import { useWorkspace } from "./workspace-context";
import { activityStatus } from "./presentation";

const lifecycleLabels: Record<string, string> = {
  END: "结束活动",
  REOPEN: "重新开启活动",
  ARCHIVE: "归档活动",
  UNARCHIVE: "取消归档",
};

const lifecycleDescriptions: Record<string, string> = {
  REOPEN: "恢复记账",
  ARCHIVE: "归档后只读",
  UNARCHIVE: "恢复使用",
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

type ActivityManagementView = "root" | "transfer" | "audit" | "cover";

type ExpandedChoice = "baseCurrency" | "inviteMode" | null;

type ManagementConfirmation = { kind: "lifecycle"; action: string } | { kind: "delete" } | null;

function dateFromIso(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isoFromDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function activityDateLabel(start: string, end: string): string {
  if (!end) return `${start} 起`;
  return start.slice(0, 4) === end.slice(0, 4) ? `${start}–${end.slice(5)}` : `${start}–${end}`;
}

function ActivityDateValue({ start, end }: { start: string; end: string }) {
  return <span className="management-date-value"><span>{start}</span><span>{end ? `–${start.slice(0, 4) === end.slice(0, 4) ? end.slice(5) : end}` : "起"}</span></span>;
}

/** 封面子视图只在点击保存时提交草稿，避免选择缩略图时提前改变活动资料。 */
type CoverDraft =
  | { kind: "preset"; preset: ActivityCoverPreset }
  | { kind: "upload"; file: File; preview: string }
  | null;

/**
 * 活动管理根视图保持可扫描的设置列表；资料仍然直接编辑，复杂操作切换到同一 Sheet 的子视图。
 * 普通资料每次只提交一个字段；日期选择器在确认时一次提交实际变化的日期和 version。
 */
export function MorePage({
  onClose,
  closeAfterSave = false,
  onStateChange,
  view = "root",
  onViewChange,
  transferTriggerRef,
  auditTriggerRef,
  coverTriggerRef,
}: {
  onClose: () => void;
  closeAfterSave?: boolean;
  onStateChange?: (state: { busy: boolean; hasError: boolean }) => void;
  view?: ActivityManagementView;
  onViewChange?: (view: ActivityManagementView) => void;
  transferTriggerRef?: RefObject<HTMLButtonElement | null>;
  auditTriggerRef?: RefObject<HTMLButtonElement | null>;
  coverTriggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { session, activity, offline } = useWorkspace();
  const update = useUpdateActivityMutation(session.userId, activity.activityId);
  const lifecycle = useActivityLifecycleMutation(session.userId, activity.activityId);
  const remove = useDeleteActivityMutation(session.userId, activity.activityId);
  const transfer = useTransferOwnershipMutation(session.userId, activity.activityId);
  const updateCover = useUpdateActivityCoverMutation(session.userId, activity.activityId);
  const uploadCover = useUploadActivityCoverMutation(session.userId, activity.activityId);
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
  const [coverDraft, setCoverDraft] = useState<CoverDraft>(null);
  const [coverError, setCoverError] = useState<unknown>();
  const [dateOpen, setDateOpen] = useState(false);
  const [dateStart, setDateStart] = useState(activity.startDate);
  const [dateEnd, setDateEnd] = useState(activity.endDate ?? "");
  const [dateStep, setDateStep] = useState<"start" | "end">("start");
  const [dateMonth, setDateMonth] = useState(() => dateFromIso(activity.startDate));
  const [dateError, setDateError] = useState<unknown>();
  const datePickerHeadingRef = useRef<HTMLDivElement | null>(null);
  const transferPanelRef = useRef<HTMLElement | null>(null);
  const members = useMembersQuery(session.userId, activity.activityId, view === "transfer");

  const canEdit = (field: ActivityField) =>
    !offline
    && activity.fieldPermissions[field]
    && (field !== "baseCurrency" || !activity.hasAccountingRecords);
  const editingBusy = savingField !== null || update.isPending;
  const actionBusy = editingBusy || lifecycle.isPending || pendingLifecycleAction !== null || transfer.isPending || remove.isPending || deleting || exporting || updateCover.isPending || uploadCover.isPending;
  const hasError = Boolean(dateError) || Object.values(fieldErrors).some(Boolean)
    || Boolean(lifecycleActionError || transferError || transfer.error || exportError || deleteError || remove.error || coverError);

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

  useEffect(() => {
    if (view !== "cover") return;
    setCoverDraft(null);
    setCoverError(undefined);
  }, [activity.coverImageId, activity.coverPreset, view]);

  useEffect(() => {
    if (view === "cover") return;
    setCoverDraft(null);
    setCoverError(undefined);
  }, [view]);

  useEffect(() => () => {
    if (coverDraft?.kind === "upload") URL.revokeObjectURL(coverDraft.preview);
  }, [coverDraft]);

  const currentCoverPreset = (activity.coverPreset ?? 12) as ActivityCoverPreset;
  const coverBusy = updateCover.isPending || uploadCover.isPending;

  function selectCoverPreset(preset: ActivityCoverPreset) {
    setCoverError(undefined);
    if (!activity.coverImageId && preset === currentCoverPreset) {
      setCoverDraft(null);
      return;
    }
    setCoverDraft({ kind: "preset", preset });
  }

  function selectCoverFile(file: File | null) {
    setCoverError(undefined);
    setCoverDraft(file ? { kind: "upload", file, preview: URL.createObjectURL(file) } : null);
  }

  function cancelCover() {
    setCoverDraft(null);
    setCoverError(undefined);
    onViewChange?.("root");
  }

  async function saveCover() {
    if (!canEdit("cover") || !coverDraft || actionBusy) return;
    setCoverError(undefined);
    try {
      const result = coverDraft.kind === "upload"
        ? await uploadCover.mutateAsync({ version, file: coverDraft.file })
        : await updateCover.mutateAsync({ version, coverPreset: coverDraft.preset });
      setVersion(result.version);
      setCoverDraft(null);
      onViewChange?.("root");
    } catch (reason) {
      setCoverError(reason);
    }
  }

  function setDraftValue(field: ActivityField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setLastSavedField(null);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function normalizeFieldValue(field: ActivityField, value: string): string {
    return field === "location" ? value.trim() : value;
  }

  function currentFieldValue(field: ActivityField): string {
    if (field === "cover") return String(activity.coverPreset ?? "");
    if (field === "location") return activity.location ?? "";
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

  function openDatePicker(open: boolean) {
    if (!open && editingBusy) return;
    if (open) {
      setDateStart(activity.startDate);
      setDateEnd(activity.endDate ?? "");
      setDateStep(canEdit("startDate") ? "start" : "end");
      setDateMonth(dateFromIso(activity.startDate));
      setDateError(undefined);
    } else {
      setDateError(undefined);
    }
    setDateOpen(open);
  }

  function selectDate(day: Date) {
    const value = isoFromDate(day);
    setDateError(undefined);
    if (dateStep === "start") {
      setDateStart(value);
      if (canEdit("endDate")) {
        setDateEnd("");
        setDateStep("end");
      }
    } else {
      setDateEnd(value);
      if (canEdit("startDate")) setDateStep("start");
    }
  }

  async function saveDates() {
    const input: UpdateActivityInput = { version };
    if (dateStart !== activity.startDate && canEdit("startDate")) input.startDate = dateStart;
    if (dateEnd !== (activity.endDate ?? "") && canEdit("endDate")) input.endDate = dateEnd || null;
    if (!input.startDate && input.endDate === undefined) {
      setDateOpen(false);
      return;
    }
    setSavingField("startDate");
    setDateError(undefined);
    try {
      const result = await update.mutateAsync(input);
      setVersion(result.data.version);
      setDraft((current) => ({ ...current, startDate: dateStart, endDate: dateEnd }));
      setWarnings(result.warnings);
      setLastSavedField("startDate");
      setDateOpen(false);
    } catch (reason) {
      setDateError(reason);
    } finally {
      setSavingField(null);
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
    <div className={`activity-more activity-more--${view}`} data-overlay-initial-focus tabIndex={-1}>
      {closeAfterSave && actionBusy ? <div className="notice" role="status">正在保存，保存完成后关闭活动管理。</div> : null}
      {offline ? <div className="notice" role="status">当前离线，活动管理需要联网后使用。</div> : null}
      {warnings.map((warning) => (
        <div className="notice" key={warning} role="status">
          {warning === "EXPENSE_BEFORE_ACTIVITY_START"
            ? "活动开始日期晚于已有账单的发生时间，请检查日期或历史账单。"
            : warning}
        </div>
      ))}
      {view === "cover" ? <section className="management-subview management-cover-subview" aria-labelledby="activity-cover-heading">
        <div className="management-subview__intro"><h3 id="activity-cover-heading">选择活动封面</h3><p>保存后会同步到活动列表和工作台页头。</p></div>
        <div className="management-cover-preview">
          {coverDraft?.kind === "upload"
            ? <img src={coverDraft.preview} alt="自定义封面预览" />
            : coverDraft?.kind === "preset"
              ? <img src={activityCoverPresetPath(coverDraft.preset)} alt="活动封面预览" />
              : <ActivityCover activityId={activity.activityId} coverPreset={currentCoverPreset} coverImageId={activity.coverImageId} alt="当前活动封面" />}
        </div>
        <div className="activity-cover-picker" role="group" aria-label="活动封面选项">
          {ACTIVITY_COVER_GROUPS.map((group) => <div key={group.label}>
            <small>{group.label}</small>
            <div className="activity-cover-picker__grid">
              {group.presets.map((preset) => {
                const selected = coverDraft?.kind === "preset"
                  ? coverDraft.preset === preset
                  : !activity.coverImageId && currentCoverPreset === preset;
                return <button key={preset} type="button" className={selected ? "is-selected" : ""} aria-label={ACTIVITY_COVER_LABELS[preset]} aria-pressed={selected} disabled={actionBusy} onClick={() => selectCoverPreset(preset)}><img src={activityCoverPresetPath(preset)} alt="" width={80} height={60} /></button>;
              })}
            </div>
          </div>)}
          <label className={`activity-cover-upload${coverDraft?.kind === "upload" ? " is-selected" : ""}`} aria-disabled={actionBusy}>
            <span>{coverDraft?.kind === "upload" ? "已选择自定义封面" : "上传自定义封面"}</span>
            <input aria-label="上传自定义封面" type="file" accept="image/jpeg,image/png,image/webp" disabled={actionBusy} onChange={(event: ChangeEvent<HTMLInputElement>) => selectCoverFile(event.target.files?.[0] ?? null)} />
          </label>
        </div>
        {coverError || updateCover.error || uploadCover.error ? <ErrorNotice error={coverError ?? updateCover.error ?? uploadCover.error} /> : null}
        <div className="management-cover-action-dock"><Button variant="secondary" type="button" disabled={actionBusy} onClick={cancelCover}>取消</Button><Button type="button" busy={coverBusy} aria-busy={coverBusy} disabled={offline || !coverDraft || actionBusy} onClick={() => void saveCover()}>保存封面</Button></div>
      </section> : view === "transfer" ? <section ref={transferPanelRef} className="management-subview" aria-labelledby="activity-transfer-heading" tabIndex={-1}>
        <div className="management-subview__intro">
          <h3 id="activity-transfer-heading">选择新的活动所有者</h3>
          <p>对方将成为所有者，你将成为普通成员。</p>
        </div>
        {members.isPending ? <LoadingState label="正在读取可转让成员…" /> : null}
        {members.error ? <ErrorNotice error={members.error} /> : null}
        {!members.isPending && !members.error && candidates.length ? <div className="management-member-list" role="radiogroup" aria-label="新所有者">{candidates.map((member) => <button key={member.memberId} type="button" role="radio" aria-checked={memberId === member.memberId} disabled={actionBusy} onClick={() => setMemberId(member.memberId)}><MemberAvatar memberId={member.memberId} userId={member.userId} displayName={member.displayName} avatarPreset={member.avatarPreset} avatarImageId={member.avatarImageId} size="sm" /><span>{member.displayName}</span>{memberId === member.memberId ? <Check aria-hidden="true" size={18} /> : null}</button>)}</div> : null}
        {!members.isPending && !members.error && !candidates.length ? <p className="empty-copy">暂无可转让的已绑定账号成员。</p> : null}
        {transferError ?? transfer.error ? <ErrorNotice error={transferError ?? transfer.error} /> : null}
        <div className="management-expansion__actions"><Button variant="secondary" type="button" disabled={actionBusy} onClick={() => onViewChange?.("root")}>取消</Button><Button type="button" busy={transfer.isPending} disabled={!memberId || actionBusy} onClick={() => void confirmTransfer()}>确认转让</Button></div>
      </section> : view === "audit" ? <section className="management-subview management-subview--audit" aria-label="活动记录"><ActivityAuditPanel userId={session.userId} activityId={activity.activityId} offline={offline} /></section> : <section aria-label="活动设置">
          <div className="management-list" role="list">
            {!offline && activity.currentMemberRole === "OWNER" ? <div className="management-action-item" role="listitem"><button ref={coverTriggerRef} className="management-action-row management-action-row--navigate" type="button" disabled={actionBusy || !activity.fieldPermissions.cover} onClick={() => onViewChange?.("cover")}><Pencil aria-hidden="true" size={19} /><span><strong>封面</strong><small>选择或上传封面</small></span><span className="management-action-row__status"><ChevronRight aria-hidden="true" size={18} /></span></button></div> : null}
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
            <div className="management-field management-field--dates" role="listitem">
              <div className="management-field__heading"><CalendarDays aria-hidden="true" size={17} /><span><strong>活动日期</strong></span></div>
              {canEdit("startDate") || canEdit("endDate") ? <Popover.Root open={dateOpen} onOpenChange={openDatePicker} modal>
                <Popover.Trigger asChild><button className="management-date-trigger" type="button" aria-label={`活动日期 ${activityDateLabel(draft.startDate, draft.endDate)}`} disabled={actionBusy}><ActivityDateValue start={draft.startDate} end={draft.endDate} />{fieldStatus("startDate", <ChevronDown aria-hidden="true" size={16} />)}</button></Popover.Trigger>
                <Popover.Portal><Popover.Content className="management-date-popover" side="bottom" align="end" sideOffset={8} collisionPadding={12} onOpenAutoFocus={(event) => { event.preventDefault(); datePickerHeadingRef.current?.focus({ preventScroll: true }); }} onKeyDownCapture={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!editingBusy) openDatePicker(false); } }}>
                  <div ref={datePickerHeadingRef} className="management-date-popover__heading" tabIndex={-1}>选择活动日期</div>
                  <div className="management-date-popover__range" aria-live="polite">
                    <span>开始日期 <strong>{dateStart}</strong></span><span>结束日期 <strong>{dateEnd || "未设置"}</strong></span>
                  </div>
                  <DayPicker mode="range" locale={zhCN} month={dateMonth} onMonthChange={setDateMonth} selected={{ from: dateFromIso(dateStart), to: dateEnd ? dateFromIso(dateEnd) : undefined }} onDayClick={selectDate} disabled={editingBusy || (dateStep === "end" ? { before: dateFromIso(dateStart) } : !canEdit("endDate") && dateEnd ? { after: dateFromIso(dateEnd) } : undefined)} />
                  <div className="management-date-popover__actions"><Button variant="ghost" type="button" disabled={!canEdit("endDate") || !dateEnd || editingBusy} onClick={() => { setDateEnd(""); setDateError(undefined); }}>清除结束日期</Button><Button variant="secondary" type="button" disabled={editingBusy} onClick={() => openDatePicker(false)}>取消</Button><Button type="button" busy={editingBusy} disabled={!dateStart || (Boolean(dateEnd) && dateEnd < dateStart)} onClick={() => void saveDates()}>保存</Button></div>
                  {dateError ? <ErrorNotice error={dateError} /> : null}
                </Popover.Content></Popover.Portal>
              </Popover.Root> : <><span className="management-field__readonly"><ActivityDateValue start={activity.startDate} end={activity.endDate ?? ""} /></span><span className="management-field__status" aria-hidden="true" /></>}
            </div>
            <div className="management-field" role="listitem">
              <div className="management-field__heading"><CircleDollarSign aria-hidden="true" size={17} /><span><strong>主币种</strong>{activity.hasAccountingRecords ? <small>账务锁定</small> : !activity.fieldPermissions.baseCurrency ? <small>无编辑权</small> : null}</span></div>
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
            <div className="management-action-item" role="listitem"><button className="management-action-row management-action-row--command" type="button" aria-label="导出 CSV" disabled={actionBusy} aria-busy={exporting} aria-describedby="activity-export-description" onClick={() => void exportCsv()}><Download aria-hidden="true" size={19} /><span><strong>导出 CSV</strong><small id="activity-export-description">下载账务明细</small></span><span className="management-action-row__status" role="status">{exporting ? <LoaderCircle aria-label="正在准备 CSV" className="spinner" size={17} /> : null}</span></button></div>
            <div className="management-action-item" role="listitem"><button ref={auditTriggerRef} className="management-action-row management-action-row--navigate" type="button" disabled={offline || actionBusy} onClick={() => onViewChange?.("audit")}><History aria-hidden="true" size={19} /><span><strong>活动记录</strong><small>{offline ? "联网后查看记录" : "查看变更记录"}</small></span><span className="management-action-row__status"><ChevronRight aria-hidden="true" size={18} /></span></button></div>
            <div className="management-field management-field--readonly" role="listitem">
              <div className="management-field__heading"><UsersRound aria-hidden="true" size={17} /><span><strong>当前状态</strong></span></div>
              <span className="management-field__readonly">{activityStatus(activity.status)}</span>
              <span className="management-field__status" aria-hidden="true" />
            </div>
            {!offline && activity.allowedLifecycleActions.length ? activity.allowedLifecycleActions.flatMap((action) => {
              const label = lifecycleLabels[action];
              if (!label) return [];
              const icon = action === "END" ? <CircleStop aria-hidden="true" size={19} /> : action === "REOPEN" ? <RotateCcw aria-hidden="true" size={19} /> : action === "ARCHIVE" ? <Archive aria-hidden="true" size={19} /> : <ArchiveRestore aria-hidden="true" size={19} />;
              return [<div className="management-action-item" role="listitem" key={action}><button className="management-action-row management-action-row--command" type="button" disabled={actionBusy} aria-busy={pendingLifecycleAction === action} onClick={() => requestLifecycle(action)}>{icon}<span><strong>{label}</strong>{action === "END" ? null : <small>{lifecycleDescriptions[action]}</small>}</span><span className="management-action-row__status" role="status">{pendingLifecycleAction === action ? <LoaderCircle aria-label={`正在${label}`} className="spinner" size={17} /> : null}</span></button></div>];
            }) : null}
            {!offline && activity.currentMemberRole === "OWNER" ? <div className="management-action-item" role="listitem"><button ref={transferTriggerRef} className="management-action-row management-action-row--navigate" type="button" disabled={actionBusy} onClick={openTransfer}><UserRoundCheck aria-hidden="true" size={19} /><span><strong>转让所有权</strong></span><span className="management-action-row__status"><ChevronRight aria-hidden="true" size={18} /></span></button></div> : null}
            {!offline && activity.canDelete ? <div className="management-action-item" role="listitem"><button className="management-action-row management-action-row--command management-action-row--danger" type="button" disabled={actionBusy} onClick={() => { setConfirmation({ kind: "delete" }); setDeleteError(undefined); }}><Trash2 aria-hidden="true" size={19} /><span><strong>删除活动</strong></span><span className="management-action-row__status" role="status">{deleting ? <LoaderCircle aria-label="正在删除活动" className="spinner" size={17} /> : null}</span></button></div> : null}
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
  const auditTriggerRef = useRef<HTMLButtonElement | null>(null);
  const coverTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousView = useRef<ActivityManagementView>("root");

  useEffect(() => {
    if (view === "root") {
      if (previousView.current === "transfer") transferTriggerRef.current?.focus();
      if (previousView.current === "audit") auditTriggerRef.current?.focus();
      if (previousView.current === "cover") coverTriggerRef.current?.focus();
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
      title={view === "transfer" ? "转让所有权" : view === "audit" ? "活动记录" : view === "cover" ? "活动封面" : "活动管理"}
      onBeforeClose={requestClose}
      onClose={onClose}
      onBack={view !== "root" ? { label: "返回活动管理", onClick: () => { if (!state.busy) setView("root"); } } : undefined}
      focusKey={`management-${view}`}
      className={`activity-management-overlay activity-management-overlay--${view}`}
    >
      <MorePage
        onClose={onClose}
        closeAfterSave={closeAfterSave}
        onStateChange={setState}
        view={view}
        onViewChange={setView}
        transferTriggerRef={transferTriggerRef}
        auditTriggerRef={auditTriggerRef}
        coverTriggerRef={coverTriggerRef}
      />
    </Overlay>
  );
}
