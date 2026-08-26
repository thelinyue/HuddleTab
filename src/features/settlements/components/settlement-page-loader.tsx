"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import {
  createSettlement,
  getSettlementContext,
  getSettlements,
  type SettlementPageContextDto,
  type SettlementDto,
} from "@/features/settlements/api";
import { SettlementPage } from "@/features/settlements/components/settlement-page";

/** 加载器只协调权威快照刷新，展示与提交流程保留在可独立测试的 SettlementPage。 */
export function SettlementPageLoader() {
  const { activityId } = useParams<{ activityId: string }>();
  const [context, setContext] = useState<SettlementPageContextDto | null>(null);
  const [settlements, setSettlements] = useState<readonly SettlementDto[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getSettlementContext(activityId),
      getSettlements(activityId),
    ])
      .then(([nextContext, nextSettlements]) => {
        if (cancelled) return;
        setContext(nextContext);
        setSettlements(nextSettlements);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "结算数据加载失败，请稍后重试。",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, refresh]);
  if (error)
    return (
      <p role="alert" className="py-8 text-destructive">
        {error}
      </p>
    );
  if (!context)
    return <p className="py-8 text-muted-foreground">正在加载结算…</p>;
  return (
    <SettlementPage
      data={{ ...context, settlements }}
      createSettlement={(input) => createSettlement(activityId, input)}
      onSaved={() => setRefresh((value) => value + 1)}
    />
  );
}
