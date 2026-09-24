import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AUTH_EXPIRED_EVENT } from "../../api/client";
import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

export type AdminUser = components["schemas"]["AdminUserData"];
export type RegistrationPolicy = components["schemas"]["RegistrationPolicyData"];
export type StorageUsage = components["schemas"]["StorageData"];
export type SystemInformation = components["schemas"]["SystemInformationData"];
export type AiSettings = components["schemas"]["AiSettingsView"];
export type AiSettingsInput = components["schemas"]["AiSettingsRequest"];

async function getUsers(): Promise<AdminUser[]> {
  return unwrap(await apiClient.GET("/api/admin/users")).data;
}

async function getPolicy(): Promise<RegistrationPolicy> {
  return unwrap(await apiClient.GET("/api/admin/registration-policy")).data;
}

async function getStorage(): Promise<StorageUsage> {
  return unwrap(await apiClient.GET("/api/admin/storage")).data;
}

async function getSystemInformation(): Promise<SystemInformation> {
  return unwrap(await apiClient.GET("/api/admin/system-information")).data;
}

async function getAiSettings(): Promise<AiSettings> {
  return unwrap(await apiClient.GET("/api/admin/ai-expense-draft-settings")).data;
}

export function useAdminUsersQuery(userId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminUsers(userId),
    queryFn: getUsers,
    enabled: userId.length > 0 && enabled,
    retry: false,
  });
}

export function useRegistrationPolicyQuery(userId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminRegistrationPolicy(userId),
    queryFn: getPolicy,
    enabled: userId.length > 0 && enabled,
    retry: false,
  });
}

export function useAdminStorageQuery(userId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminStorage(userId),
    queryFn: getStorage,
    enabled: userId.length > 0 && enabled,
    retry: false,
  });
}

export function useSystemInformationQuery(userId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminSystemInformation(userId),
    queryFn: getSystemInformation,
    enabled: userId.length > 0 && enabled,
    retry: false,
  });
}

export function useAiSettingsQuery(userId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminAiSettings(userId),
    queryFn: getAiSettings,
    enabled: userId.length > 0 && enabled,
    retry: false,
  });
}

export function useDeleteAdminUserMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (targetUserId: string) =>
      unwrap(await apiClient.DELETE("/api/admin/users/{user_id}", {
        params: { path: { user_id: targetUserId } },
        headers: await mutationHeaders(),
      })).data,
    onSuccess: async (_result, targetUserId) => {
      if (targetUserId === userId && typeof window !== "undefined") {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        return;
      }
      // 服务端确认后才移除账号；取消旧请求，防止已删除账号重新出现在列表中。
      await queryClient.cancelQueries({ queryKey: queryKeys.adminUsers(userId) });
      queryClient.setQueryData<AdminUser[]>(queryKeys.adminUsers(userId), (users) => users?.filter((user) => user.id !== targetUserId));
      // 删除已完成，后台刷新不应延迟关闭面板与成功反馈。
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers(userId) });
    },
  });
}

export function useUpdateAdminUserStatusMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId: targetUserId, disabled }: { userId: string; disabled: boolean }) =>
      unwrap(await apiClient.PATCH("/api/admin/users/{user_id}/status", {
        params: { path: { user_id: targetUserId } },
        body: { disabled },
        headers: await mutationHeaders(),
      })).data,
    onSuccess: async (_result, variables) => {
      if (variables.userId === userId && variables.disabled && typeof window !== "undefined") {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        return;
      }
      // 仅在服务端确认后更新列表，面板和分类计数同时变化；取消旧读取，避免旧状态覆盖结果。
      await queryClient.cancelQueries({ queryKey: queryKeys.adminUsers(userId) });
      queryClient.setQueryData<AdminUser[]>(queryKeys.adminUsers(userId), (users) => users?.map((user) => user.id === variables.userId ? { ...user, disabled: variables.disabled } : user));
      return queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers(userId) });
    },
  });
}

export function useUpdateAdminRoleMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId: targetUserId, granted }: { userId: string; granted: boolean }) =>
      unwrap(await apiClient.PATCH("/api/admin/users/{user_id}/system-admin", {
        params: { path: { user_id: targetUserId } },
        body: { granted },
        headers: await mutationHeaders(),
      })).data,
    onSuccess: async (_result, variables) => {
      if (variables.userId === userId && !variables.granted && typeof window !== "undefined") {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        return;
      }
      await queryClient.cancelQueries({ queryKey: queryKeys.adminUsers(userId) });
      queryClient.setQueryData<AdminUser[]>(queryKeys.adminUsers(userId), (users) => users?.map((user) => user.id === variables.userId ? { ...user, isSystemAdmin: variables.granted } : user));
      return queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers(userId) });
    },
  });
}

export function useResetAdminPasswordMutation(actorUserId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId: targetUserId, newPassword }: { userId: string; newPassword: string }) =>
      unwrap(await apiClient.PUT("/api/admin/users/{user_id}/password", {
        params: { path: { user_id: targetUserId } },
        body: { newPassword },
        headers: await mutationHeaders(),
      })).data,
    onSuccess: (_result, variables) => {
      if (variables.userId === actorUserId && typeof window !== "undefined") {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        return;
      }
      return queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers(actorUserId) });
    },
  });
}

export function useUpdateRegistrationPolicyMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ policy, version }: { policy: "OPEN" | "INVITE_ONLY"; version: number }) =>
      unwrap(await apiClient.PUT("/api/admin/registration-policy", {
        body: { policy, version },
        headers: await mutationHeaders(),
      })).data,
    onSuccess: ({ policy }) => {
      queryClient.setQueryData(queryKeys.registrationPolicy, policy);
      return queryClient.invalidateQueries({ queryKey: queryKeys.adminRegistrationPolicy(userId) });
    },
  });
}

export function useUpdateAiSettingsMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AiSettingsInput) =>
      unwrap(await apiClient.PUT("/api/admin/ai-expense-draft-settings", {
        body: input,
        headers: await mutationHeaders(),
      })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminAiSettings(userId) }),
  });
}
