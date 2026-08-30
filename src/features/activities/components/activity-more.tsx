"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarDaysIcon,
  ChevronRightIcon,
  CircleDollarSignIcon,
  DownloadIcon,
  FlagIcon,
  MapPinIcon,
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
import {
  getActivityHome,
  type ActivityHomeItem,
} from "@/features/activities/api";
import { ActivityPageHeader } from "@/features/activities/components/activity-page-header";
import {
  OfflineStatus,
  useOnlineStatus,
} from "@/features/expenses/components/offline-status";

type Context = {
  activity: {
    status: "ACTIVE" | "ENDED" | "ARCHIVED";
    currentMemberStatus: "ACTIVE" | "LEFT";
    currentMemberRole: "OWNER" | "ADMIN" | "MEMBER";
  };
};
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
const nextStatus = {
  end: "ENDED",
  reopen: "ACTIVE",
  archive: "ARCHIVED",
  unarchive: "ENDED",
} as const;
const statusLabels = {
  ACTIVE: "进行中",
  ENDED: "已结束",
  ARCHIVED: "已归档",
} as const;

function commands(context: Context | null): readonly (keyof typeof labels)[] {
  if (!context || context.activity.currentMemberStatus !== "ACTIVE") return [];
  const role = context.activity.currentMemberRole;
  if (role === "MEMBER") return [];
  return actions[context.activity.status].filter(
    (action) => action === "end" || action === "reopen" || role === "OWNER",
  );
}

/** 更多页分开读取展示资料和结算上下文权限；权限仍以服务端上下文为准。 */
export function ActivityMore({
  embedded = false,
}: {
  readonly embedded?: boolean;
}) {
  const { activityId } = useParams<{ activityId: string }>();
  const [context, setContext] = useState<Context | null>(null);
  const [activity, setActivity] = useState<ActivityHomeItem | null>(null);
  const [message, setMessage] = useState<{
    readonly text: string;
    readonly level: "status" | "alert";
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    keyof typeof labels | null
  >(null);
  const online = useOnlineStatus();

  useEffect(() => {
    void Promise.all([
      getActivityHome(),
      fetch(`/api/activities/${activityId}/settlements/context`, {
        cache: "no-store",
      }).then(async (response) => {
        if (!response.ok) throw new Error("活动信息加载失败，请稍后重试。");
        return (await response.json()).data as Context;
      }),
    ])
      .then(([home, nextContext]) => {
        const item = [...home.active, ...home.ended, ...home.archived].find(
          (candidate) => candidate.id === activityId,
        );
        if (!item) throw new Error("活动不存在或您无权查看。");
        setActivity(item);
        setContext(nextContext);
      })
      .catch((reason: unknown) =>
        setMessage({
          text:
            reason instanceof Error
              ? reason.message
              : "活动信息加载失败，请稍后重试。",
          level: "alert",
        }),
      );
  }, [activityId]);

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
      setMessage({ text: "活动状态已更新。", level: "status" });
      setContext((current) =>
        current
          ? {
              ...current,
              activity: { ...current.activity, status: nextStatus[action] },
            }
          : current,
      );
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
  const lifecycleActions = commands(context);
  const canDelete =
    context?.activity.currentMemberStatus === "ACTIVE" &&
    context.activity.currentMemberRole === "OWNER";
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
      {!embedded && activity && context ? (
        <>
          <ActivityPageHeader
            activityId={activityId}
            name={activity.name}
            startDate={activity.startDate ?? ""}
            endDate={activity.endDate ?? null}
            memberCount={activity.memberCount ?? 0}
            status={context.activity.status}
            moreAction={false}
          />
        </>
      ) : null}
      {!activity && !message ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          正在加载活动信息…
        </p>
      ) : null}
      {activity && context ? (
        <>
          <section
            className="mt-6"
            aria-labelledby="activity-information-heading"
          >
            <h2
              id="activity-information-heading"
              className="text-base font-semibold"
            >
              活动信息
            </h2>
            <dl className={surface}>
              <InfoRow
                Icon={MapPinIcon}
                label="地点"
                value={activity.location || "未填写"}
                tone="primary"
              />
              <InfoRow
                Icon={CircleDollarSignIcon}
                label="主币种"
                value={activity.baseCurrency || "未填写"}
                tone="primary"
              />
              <InfoRow
                Icon={CalendarDaysIcon}
                label="开始日期"
                value={activity.startDate || "未填写"}
                tone="primary"
              />
              <InfoRow
                Icon={CalendarDaysIcon}
                label="结束日期"
                value={activity.endDate || "未填写"}
                tone="primary"
              />
              <InfoRow
                Icon={FlagIcon}
                label="状态"
                value={statusLabels[context.activity.status]}
                tone="primary"
              />
            </dl>
          </section>
          <section className="mt-6" aria-labelledby="sharing-heading">
            <h2 id="sharing-heading" className="text-base font-semibold">
              协作与分享
            </h2>
            <div className={surface}>
              <Link
                href={`/share-summary/${activityId}`}
                className="flex min-h-12 items-center gap-3 px-3 text-sm transition-colors hover:bg-muted/45 focus-visible:bg-muted/45"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Share2Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">结算摘要分享</span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground/70"
                />
              </Link>
              <a
                href={`/api/activities/${activityId}/export.csv`}
                className="flex min-h-12 items-center gap-3 px-3 text-sm transition-colors hover:bg-muted/45 focus-visible:bg-muted/45"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <DownloadIcon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">导出 CSV</span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground/70"
                />
              </a>
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
              <h2
                id="danger-heading"
                className="text-base font-semibold text-destructive"
              >
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
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-destructive/70"
                />
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
              活动会进入回收状态，30
              天内可恢复；超过期限后将永久删除成员和账务记录。
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

function InfoRow({
  Icon,
  label,
  value,
  tone = "muted",
}: {
  readonly Icon?: LucideIcon;
  readonly label: string;
  readonly value: string;
  readonly tone?: "primary" | "success" | "orange" | "muted";
}) {
  const colors = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    orange: "bg-orange/15 text-orange",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <div className="flex min-h-11 items-center gap-3 px-3 py-2">
      {Icon ? (
        <span
          aria-hidden="true"
          className={`flex size-7 shrink-0 items-center justify-center rounded-full ${colors[tone]}`}
        >
          <Icon className="size-4" />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className={`size-7 shrink-0 rounded-full ${colors[tone]}`}
        />
      )}
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="ml-auto min-w-0 truncate text-sm">{value}</dd>
    </div>
  );
}
