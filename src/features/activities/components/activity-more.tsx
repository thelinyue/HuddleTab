"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppHeader } from "@/components/design-system/app-header";
import { StatusBadge } from "@/components/design-system/status-badge";
import {
  OfflineStatus,
  useOnlineStatus,
} from "@/features/expenses/components/offline-status";
type Context = {
  activity: {
    status: "ACTIVE" | "ENDED" | "ARCHIVED";
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
const statusContent = {
  ACTIVE: { label: "进行中", tone: "success", icon: "success" },
  ENDED: { label: "已结束", tone: "warning", icon: "warning" },
  ARCHIVED: { label: "已归档", tone: "neutral", icon: "info" },
} as const;
/** 更多页只显示与服务器状态一致的生命周期命令，服务端仍是最终权限与状态权威。 */
export function ActivityMore() {
  const { activityId } = useParams<{ activityId: string }>();
  const [context, setContext] = useState<Context | null>(null);
  const [message, setMessage] = useState<{
    readonly text: string;
    readonly level: "status" | "alert";
  } | null>(null);
  const online = useOnlineStatus();
  useEffect(() => {
    void fetch(`/api/activities/${activityId}/settlements/context`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("活动信息加载失败，请稍后重试。");
        return (await response.json()).data as Context;
      })
      .then(setContext)
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
    if (!online) return;
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
    } catch {
      setMessage({
        text: "活动操作未完成，请检查网络后重试。",
        level: "alert",
      });
    }
  };
  const canManage =
    context?.activity.currentMemberRole === "OWNER" ||
    context?.activity.currentMemberRole === "ADMIN";
  return (
    <section className="py-5">
      <AppHeader
        title="更多"
        subtitle="活动设置与导出"
        actions={
          context ? (
            <StatusBadge
              tone={statusContent[context.activity.status].tone}
              icon={statusContent[context.activity.status].icon}
            >
              {statusContent[context.activity.status].label}
            </StatusBadge>
          ) : null
        }
      />
      <div className="mt-5 divide-y border-y">
        <Link
          href={`/activities/${activityId}/summary`}
          className="flex min-h-11 items-center"
        >
          结算摘要
        </Link>
        <a
          href={`/api/activities/${activityId}/export.csv`}
          className="flex min-h-11 items-center"
        >
          导出 CSV
        </a>
      </div>
      {canManage && context && (
        <section className="mt-8 border-t pt-4">
          <h2 className="font-semibold">活动操作</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {actions[context.activity.status].map((action) => (
              <button
                key={action}
                type="button"
                disabled={!online}
                className="min-h-11 border px-3"
                onClick={() => void run(action)}
              >
                {labels[action]}
              </button>
            ))}
          </div>
          {!online && <OfflineStatus>活动操作必须联网后执行。</OfflineStatus>}
        </section>
      )}
      {message && (
        <p role={message.level} className="mt-3 text-sm text-muted-foreground">
          {message.text}
        </p>
      )}
    </section>
  );
}
