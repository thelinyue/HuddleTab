"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CalendarDaysIcon,
  ChevronRightIcon,
  CircleDollarSignIcon,
  DownloadIcon,
  FlagIcon,
  MapPinIcon,
  PencilIcon,
  Share2Icon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCurrencyDisplayName } from "@/domain/currency/currency";
import {
  getActivityDetails,
  getActivityHome,
  updateActivityDetails,
  type ActivityDetailsDto,
  type ActivityHomeItem,
  type UpdateActivityDetailsInput,
} from "@/features/activities/api";
import { ActivityPageHeader } from "@/features/activities/components/activity-page-header";
import { CurrencyPickerOptions } from "@/features/currency/components/currency-picker";
import {
  OfflineStatus,
  useOnlineStatus,
} from "@/features/expenses/components/offline-status";

export type ActivityManagementView =
  | "root"
  | "name"
  | "location"
  | "baseCurrency"
  | "startDate"
  | "endDate";

const actions = {
  ACTIVE: ["end"],
  ENDED: ["reopen", "archive"],
  ARCHIVED: ["unarchive"],
} as const;
const labels = {
  end: "结束活动",
  reopen: "恢复活动",
  archive: "归档活动",
  unarchive: "解除归档",
} as const;
const statusLabels = {
  ACTIVE: "进行中",
  ENDED: "已结束",
  ARCHIVED: "已归档",
} as const;

function commands(
  activity: ActivityDetailsDto | null,
): readonly (keyof typeof labels)[] {
  if (!activity || activity.currentMemberStatus !== "ACTIVE") return [];
  if (activity.currentMemberRole === "MEMBER") return [];
  return actions[activity.status].filter(
    (action) =>
      action === "end" ||
      action === "reopen" ||
      activity.currentMemberRole === "OWNER",
  );
}

function fieldValue(
  activity: ActivityDetailsDto,
  view: Exclude<ActivityManagementView, "root">,
) {
  const value = activity[view];
  return value ?? "";
}

function updateInputFor(
  revision: string,
  view: Exclude<ActivityManagementView, "root">,
  draft: string,
): UpdateActivityDetailsInput {
  const value = draft.trim();
  if (view === "name") return { revision, name: value };
  if (view === "location") return { revision, location: value || null };
  if (view === "baseCurrency") return { revision, baseCurrency: value };
  if (view === "startDate") return { revision, startDate: value };
  return { revision, endDate: value || null };
}

/**
 * 活动管理页使用服务端返回的字段级权限决定交互能力。只读行不渲染按钮和 Chevron，
 * 因此生命周期、成员状态或账务锁定发生变化后，重新获取详情即可同步全部入口。
 */
export function ActivityMore({
  embedded = false,
  view,
  onViewChange,
}: {
  readonly embedded?: boolean;
  readonly view?: ActivityManagementView;
  readonly onViewChange?: (view: ActivityManagementView) => void;
}) {
  const { activityId } = useParams<{ activityId: string }>();
  const [activity, setActivity] = useState<ActivityDetailsDto | null>(null);
  const [homeActivity, setHomeActivity] = useState<ActivityHomeItem | null>(
    null,
  );
  const [internalView, setInternalView] =
    useState<ActivityManagementView>("root");
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<{
    readonly text: string;
    readonly level: "status" | "alert";
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    keyof typeof labels | null
  >(null);
  const online = useOnlineStatus();
  const activeView = view ?? internalView;
  const setView = onViewChange ?? setInternalView;

  const refreshDetails = useCallback(async () => {
    const next = await getActivityDetails(activityId);
    setActivity(next);
    return next;
  }, [activityId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [details, home] = await Promise.all([
          getActivityDetails(activityId),
          embedded ? Promise.resolve(null) : getActivityHome(),
        ]);
        if (!active) return;
        setActivity(details);
        if (home) {
          setHomeActivity(
            [...home.active, ...home.ended, ...home.archived].find(
              (candidate) => candidate.id === activityId,
            ) ?? null,
          );
        }
      } catch (reason) {
        if (!active) return;
        setMessage({
          text:
            reason instanceof Error
              ? reason.message
              : "活动信息加载失败，请稍后重试。",
          level: "alert",
        });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [activityId, embedded]);

  const openField = (nextView: Exclude<ActivityManagementView, "root">) => {
    if (!activity?.permissions[nextView]) return;
    setDraft(fieldValue(activity, nextView));
    setMessage(null);
    setView(nextView);
  };

  const saveField = async () => {
    if (!activity || activeView === "root" || saving || !online) return;
    const input = updateInputFor(activity.revision, activeView, draft);

    setSaving(true);
    setMessage(null);
    try {
      const result = await updateActivityDetails(activityId, input);
      await refreshDetails();
      setMessage({
        text: result.warnings.includes("EXPENSE_BEFORE_ACTIVITY_START")
          ? "已有部分消费时间早于新的活动开始日期。"
          : "活动资料已保存。",
        level: "status",
      });
      setView("root");
    } catch (reason) {
      setMessage({
        text:
          reason instanceof Error
            ? reason.message
            : "活动资料保存失败，请稍后重试。",
        level: "alert",
      });
    } finally {
      setSaving(false);
    }
  };

  const run = async (action: keyof typeof labels) => {
    if (!online || pendingAction) return;
    setPendingAction(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/activities/${activityId}/${action}`, {
        method: "POST",
      });
      if (!response.ok) {
        setMessage({ text: "活动操作未完成，请刷新后重试。", level: "alert" });
        return;
      }
      await refreshDetails();
      setMessage({ text: "活动状态已更新。", level: "status" });
    } catch {
      setMessage({
        text: "活动操作未完成，请检查网络后重试。",
        level: "alert",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const remove = async () => {
    if (!online || deleting) return;
    setDeleting(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/activities/${activityId}/delete`, {
        method: "POST",
      });
      if (!response.ok) {
        setMessage({ text: "删除活动未完成，请刷新后重试。", level: "alert" });
        return;
      }
      window.location.assign(
        new URL("/activities", window.location.origin).toString(),
      );
    } catch {
      setMessage({
        text: "删除活动未完成，请检查网络后重试。",
        level: "alert",
      });
    } finally {
      setDeleting(false);
    }
  };

  const lifecycleActions = commands(activity);
  const canDelete =
    activity?.currentMemberStatus === "ACTIVE" &&
    activity.currentMemberRole === "OWNER";
  const surface = "mt-3 divide-y overflow-hidden rounded-sm border bg-surface";

  return (
    <section
      data-testid="activity-more-surface"
      className={
        embedded
          ? "min-w-0"
          : "-mx-4 -mt-[calc(1rem+env(safe-area-inset-top))] min-h-dvh min-w-0 bg-surface px-4 pt-[calc(1rem+env(safe-area-inset-top))] min-[481px]:-mx-6 min-[481px]:px-6"
      }
    >
      {!embedded && activity ? (
        <ActivityPageHeader
          activityId={activityId}
          name={activity.name}
          startDate={activity.startDate}
          endDate={activity.endDate}
          memberCount={homeActivity?.memberCount ?? 0}
          status={activity.status}
          moreAction={false}
        />
      ) : null}

      {!activity && !message ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          正在加载活动信息…
        </p>
      ) : null}

      {activity && activeView !== "root" ? (
        <ActivityFieldEditor
          view={activeView}
          value={draft}
          online={online}
          saving={saving}
          onChange={setDraft}
          onSave={() => void saveField()}
        />
      ) : null}

      {activity && activeView === "root" ? (
        <>
          <section className="mt-6" aria-labelledby="activity-information-heading">
            <h2 id="activity-information-heading" className="text-base font-semibold">
              活动信息
            </h2>
            <div
              role="group"
              aria-labelledby="activity-information-heading"
              className={surface}
            >
              <InfoRow
                Icon={PencilIcon}
                label="活动名称"
                value={activity.name}
                editable={activity.permissions.name}
                onEdit={() => openField("name")}
              />
              <InfoRow
                Icon={MapPinIcon}
                label="地点"
                value={activity.location || "未填写"}
                editable={activity.permissions.location}
                onEdit={() => openField("location")}
              />
              <InfoRow
                Icon={CircleDollarSignIcon}
                label="主币种"
                value={`${activity.baseCurrency} · ${getCurrencyDisplayName(activity.baseCurrency)}`}
                helper={
                  activity.hasAccountingRecords
                    ? "已有账务记录，不可修改"
                    : undefined
                }
                editable={activity.permissions.baseCurrency}
                onEdit={() => openField("baseCurrency")}
              />
              <InfoRow
                Icon={CalendarDaysIcon}
                label="开始日期"
                value={activity.startDate}
                editable={activity.permissions.startDate}
                onEdit={() => openField("startDate")}
              />
              <InfoRow
                Icon={CalendarDaysIcon}
                label="结束日期"
                value={activity.endDate || "未填写"}
                editable={activity.permissions.endDate}
                onEdit={() => openField("endDate")}
              />
              <InfoRow
                Icon={FlagIcon}
                label="状态"
                value={statusLabels[activity.status]}
              />
            </div>
          </section>

          <section className="mt-6" aria-labelledby="sharing-heading">
            <h2 id="sharing-heading" className="text-base font-semibold">
              协作与分享
            </h2>
            <div className={surface}>
              <MoreLink
                href={`/share-summary/${activityId}`}
                Icon={Share2Icon}
                label="结算摘要分享"
              />
              <MoreLink
                href={`/api/activities/${activityId}/export.csv`}
                Icon={DownloadIcon}
                label="导出 CSV"
              />
            </div>
          </section>

          {lifecycleActions.length ? (
            <section className="mt-6" aria-labelledby="management-heading">
              <h2 id="management-heading" className="text-base font-semibold">
                管理
              </h2>
              <div className={surface}>
                {lifecycleActions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    disabled={!online || pendingAction !== null}
                    className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-sm transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 disabled:cursor-not-allowed disabled:text-muted-foreground"
                    onClick={() => void run(action)}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <FlagIcon aria-hidden="true" className="size-4" />
                    </span>
                    <span>{labels[action]}</span>
                  </button>
                ))}
              </div>
              {!online ? (
                <OfflineStatus>活动操作必须联网后执行。</OfflineStatus>
              ) : null}
            </section>
          ) : null}

          {canDelete ? (
            <section className="mt-6" aria-labelledby="danger-heading">
              <h2 id="danger-heading" className="text-base font-semibold text-destructive">
                危险操作
              </h2>
              <button
                type="button"
                disabled={!online}
                className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-sm border border-destructive/30 bg-surface px-3 text-left text-sm text-destructive transition-colors hover:bg-destructive/5 focus-visible:bg-destructive/5 disabled:cursor-not-allowed disabled:text-muted-foreground"
                onClick={() => setDeleteOpen(true)}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                  <Trash2Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">删除活动</span>
                <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-destructive/70" />
              </button>
            </section>
          ) : null}
        </>
      ) : null}

      {message ? (
        <p
          role={message.level}
          className={`mt-3 text-sm ${message.level === "status" ? "text-success" : "text-destructive"}`}
        >
          {message.text}
        </p>
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除活动</AlertDialogTitle>
            <AlertDialogDescription>
              活动会进入回收状态，30 天内可恢复；超过期限后将永久删除成员和账务记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting || !online}
              onClick={() => void remove()}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** 字段编辑器保持显式保存；币种选择只改变草稿，不会在点选时提交。 */
function ActivityFieldEditor({
  view,
  value,
  online,
  saving,
  onChange,
  onSave,
}: {
  readonly view: Exclude<ActivityManagementView, "root">;
  readonly value: string;
  readonly online: boolean;
  readonly saving: boolean;
  readonly onChange: (value: string) => void;
  readonly onSave: () => void;
}) {
  const labels: Record<typeof view, string> = {
    name: "活动名称",
    location: "地点",
    baseCurrency: "主币种",
    startDate: "开始日期",
    endDate: "结束日期",
  };
  const label = labels[view];
  return (
    <form
      className={
        view === "baseCurrency"
          ? "flex h-[calc(100dvh-5rem-env(safe-area-inset-top))] min-h-0 flex-col pt-2 md:h-[min(70dvh,40rem)]"
          : "flex min-h-[50dvh] flex-col pt-2"
      }
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      {view === "baseCurrency" ? (
        <CurrencyPickerOptions value={value} onSelect={onChange} />
      ) : (
        <label className="grid gap-2 text-sm font-medium">
          {label}
          <Input
            autoFocus
            aria-label={label}
            type={view === "startDate" || view === "endDate" ? "date" : "text"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      )}
      <Button
        type="submit"
        className="mt-4 w-full"
        disabled={!online || saving || (view === "name" && !value.trim())}
      >
        {saving ? "保存中…" : "保存"}
      </Button>
      {!online ? <OfflineStatus>活动资料必须联网后保存。</OfflineStatus> : null}
    </form>
  );
}

function InfoRow({
  Icon,
  label,
  value,
  helper,
  editable = false,
  onEdit,
}: {
  readonly Icon: LucideIcon;
  readonly label: string;
  readonly value: string;
  readonly helper?: string;
  readonly editable?: boolean;
  readonly onEdit?: () => void;
}) {
  const content = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <span data-testid="activity-info-label" className="text-sm text-muted-foreground">
        {label}
      </span>
      <span className="ml-auto min-w-0 text-right">
        <span className="block text-sm">{value}</span>
        {helper ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{helper}</span>
        ) : null}
      </span>
      {editable ? (
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
      ) : null}
    </>
  );
  return (
    <div className="min-w-0">
      {editable ? (
        <button
          type="button"
          aria-label={`编辑${label}`}
          className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/45 focus-visible:bg-muted/45"
          onClick={onEdit}
        >
          {content}
        </button>
      ) : (
        <div className="flex min-h-12 items-center gap-3 px-3 py-2">{content}</div>
      )}
    </div>
  );
}

function MoreLink({
  href,
  Icon,
  label,
}: {
  readonly href: string;
  readonly Icon: LucideIcon;
  readonly label: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-12 items-center gap-3 px-3 text-sm transition-colors hover:bg-muted/45 focus-visible:bg-muted/45"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
    </Link>
  );
}
