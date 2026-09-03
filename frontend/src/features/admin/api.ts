import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AUTH_EXPIRED_EVENT } from "../../api/client";
import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

export type AdminUser = components["schemas"]["AdminUserData"];
export type RegistrationPolicy = components["schemas"]["RegistrationPolicyData"];

async function getUsers(): Promise<AdminUser[]> {
  return unwrap(await apiClient.GET("/api/admin/users")).data;
}

async function getPolicy(): Promise<RegistrationPolicy> {
  return unwrap(await apiClient.GET("/api/admin/registration-policy")).data;
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

export function useUpdateAdminUserStatusMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId: targetUserId, disabled }: { userId: string; disabled: boolean }) =>
      unwrap(await apiClient.PATCH("/api/admin/users/{user_id}/status", {
        params: { path: { user_id: targetUserId } },
        body: { disabled },
        headers: await mutationHeaders(),
      })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers(userId) }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers(userId) }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminRegistrationPolicy(userId) }),
  });
}
