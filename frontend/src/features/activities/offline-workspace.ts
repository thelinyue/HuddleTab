import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiRequestError } from "../../api/error";
import { queryKeys } from "../../api/query-keys";
import { SnapshotRepository } from "../../pwa/indexed-db/snapshot-repository";
import type { ActivitySnapshotData } from "../../pwa/indexed-db/schema";

export function useOnlineStatus() {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

export type OfflineWorkspaceData = {
  snapshot: ActivitySnapshotData;
  fromCache: boolean;
};

/**
 * Snapshot 是活动工作台离线读取的唯一来源。网络错误可以回退当前用户缓存，
 * 但服务端明确返回 401/403/404 时不能显示旧事实，避免把授权失效伪装成离线。
 */
export function useActivitySnapshotQuery(userId: string, activityId: string) {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (online && userId && activityId) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.activitySnapshot(userId, activityId),
      });
    }
  }, [activityId, online, queryClient, userId]);
  return useQuery<OfflineWorkspaceData>({
    queryKey: queryKeys.activitySnapshot(userId, activityId),
    networkMode: "always",
    staleTime: online ? 0 : Infinity,
    queryFn: async () => {
      const repository = new SnapshotRepository(userId);
      if (!online) {
        const cached = await repository.require(activityId);
        return { snapshot: cached.snapshot, fromCache: true };
      }
      try {
        const refreshed = await repository.refresh(activityId);
        return { snapshot: refreshed.snapshot, fromCache: false };
      } catch (error) {
        if (error instanceof ApiRequestError) throw error;
        const cached = await repository.get(activityId);
        if (!cached) throw error;
        return { snapshot: cached.snapshot, fromCache: true };
      }
    },
    enabled: userId.length > 0 && activityId.length > 0,
  });
}
