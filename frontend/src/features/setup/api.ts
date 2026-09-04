import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

export type SetupStatus = components["schemas"]["SetupStatusData"];
export type SetupRequest = components["schemas"]["SetupRequest"];
export type SetupInitializeResult = components["schemas"]["SetupInitializeData"];

async function loadSetupStatus(): Promise<SetupStatus> {
  return unwrap(await apiClient.GET("/api/setup/status")).data;
}

async function initializeSetup(input: SetupRequest): Promise<SetupInitializeResult> {
  return unwrap(await apiClient.POST("/api/setup", {
    body: input,
    headers: await mutationHeaders(),
  })).data;
}

/** 初始化状态是部署边界，不写入 IndexedDB，也不允许用离线旧值绕过守卫。 */
export function useSetupStatusQuery() {
  return useQuery({
    queryKey: queryKeys.setupStatus,
    queryFn: loadSetupStatus,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useInitializeSetupMutation() {
  return useMutation({ mutationFn: initializeSetup });
}
