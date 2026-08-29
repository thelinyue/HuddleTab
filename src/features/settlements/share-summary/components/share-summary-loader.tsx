"use client";

import { useEffect, useState } from "react";

import { getShareSummary } from "../api";
import type { ShareSummaryData } from "../types";

import { ShareSummaryCard } from "./share-summary-card";

interface ShareSummaryLoadState {
  readonly activityId: string;
  readonly data?: ShareSummaryData;
  readonly error?: string;
}

/**
 * 分享页加载器负责连接授权摘要 API 与纯展示卡片。
 * 活动 ID 变化或组件卸载时会忽略旧请求，避免快速切换活动后显示过期数据。
 */
export function ShareSummaryLoader({
  activityId,
}: {
  readonly activityId: string;
}) {
  const [loadState, setLoadState] = useState<ShareSummaryLoadState | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    void getShareSummary(activityId)
      .then((nextData) => {
        if (!cancelled) setLoadState({ activityId, data: nextData });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setLoadState({
          activityId,
          error:
            reason instanceof Error
              ? reason.message
              : "结算摘要加载失败，请稍后重试。",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activityId]);

  const currentState = loadState?.activityId === activityId ? loadState : null;

  if (currentState?.error) {
    return (
      <p role="alert" className="py-8 text-destructive">
        {currentState.error}
      </p>
    );
  }
  if (!currentState?.data) {
    return (
      <p role="status" className="py-8 text-muted-foreground">
        正在加载结算摘要…
      </p>
    );
  }
  return <ShareSummaryCard data={currentState.data} />;
}
