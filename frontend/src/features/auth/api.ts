import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { clearCsrfToken, mutationHeaders } from "../../api/csrf";
import { ApiRequestError, unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

export type Session = components["schemas"]["SessionData"];
export type LoginInput = components["schemas"]["LoginRequest"];
export type RegisterInput = components["schemas"]["RegisterRequest"];
export type ChangePasswordInput = components["schemas"]["ChangePasswordRequest"];
export type ChangePasswordResult = components["schemas"]["ChangePasswordData"];
export type InvitationPreview = components["schemas"]["InvitationPreviewData"];
export type JoinRequest = components["schemas"]["JoinRequestData"];
export type JoinInvitationResult = components["schemas"]["JoinInvitationData"];

const offlineSessionStorageKey = "huddletab:offline-session";

function rememberOfflineSession(session: Session | null) {
  if (typeof window === "undefined") return;
  if (session) sessionStorage.setItem(offlineSessionStorageKey, JSON.stringify(session));
  else sessionStorage.removeItem(offlineSessionStorageKey);
}

/** 全局认证失效时由 AppProviders 调用，避免下一次断网仍恢复已失效用户。 */
export function clearRememberedOfflineSession() {
  rememberOfflineSession(null);
}

function rememberedOfflineSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(offlineSessionStorageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    sessionStorage.removeItem(offlineSessionStorageKey);
    return null;
  }
}

async function loadSession(): Promise<Session | null> {
  try {
    const result = await apiClient.GET("/api/auth/session");
    if (result.response.status === 401) {
      clearRememberedOfflineSession();
      return null;
    }
    const session = unwrap(result).data;
    rememberOfflineSession(session);
    return session;
  } catch (error) {
    // 只有网络错误允许使用当前标签页的最近身份；服务器明确拒绝不能回退，避免泄漏旧用户。
    // openapi-fetch 会把浏览器离线请求包装成非正 status 的 ApiRequestError，
    // 它与 401/403 等服务端拒绝不同，仍可安全使用本标签页刚记住的 Session。
    if (error instanceof ApiRequestError && error.status > 0) throw error;
    return rememberedOfflineSession();
  }
}

async function login(input: LoginInput): Promise<Session> {
  const result = await apiClient.POST("/api/auth/login", {
    body: input,
    headers: await mutationHeaders(),
  });
  const data = unwrap(result).data;
  clearCsrfToken();
  rememberOfflineSession(data);
  return data;
}

async function register(input: RegisterInput): Promise<Session> {
  const result = await apiClient.POST("/api/auth/register", {
    body: input,
    headers: await mutationHeaders(),
  });
  const data = unwrap(result).data;
  clearCsrfToken();
  rememberOfflineSession(data);
  return data;
}

async function logout(): Promise<void> {
  const result = await apiClient.POST("/api/auth/logout", {
    headers: await mutationHeaders(),
  });
  unwrap(result);
  clearCsrfToken();
  clearRememberedOfflineSession();
}

/** 改密会轮换 Session Cookie；成功后必须丢弃只与旧 Session 匹配的 CSRF token。 */
async function changePassword(input: ChangePasswordInput): Promise<ChangePasswordResult> {
  const result = await apiClient.PUT("/api/me/password", {
    body: input,
    headers: await mutationHeaders(),
  });
  const data = unwrap(result).data;
  clearCsrfToken();
  return data;
}

async function previewInvitation(token: string): Promise<InvitationPreview> {
  const result = await apiClient.GET("/api/invitations/{token}", {
    params: { path: { token } },
  });
  return unwrap(result).data;
}

async function joinInvitation(token: string) {
  const result = await apiClient.POST("/api/invitations/{token}/join", {
    params: { path: { token } },
    headers: await mutationHeaders(),
  });
  return unwrap(result).data;
}

async function getJoinRequest(requestId: string): Promise<JoinRequest> {
  return unwrap(
    await apiClient.GET("/api/join-requests/{join_request_id}", {
      params: { path: { join_request_id: requestId } },
    }),
  ).data;
}

export function useSessionQuery() {
  return useQuery({ queryKey: queryKeys.session, queryFn: loadSession, retry: false });
}

export function useLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (session) => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session, session);
    },
  });
}

export function useRegisterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: register,
    onSuccess: (session) => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session, session);
    },
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => queryClient.clear(),
  });
}

export function useChangePasswordMutation() {
  return useMutation({ mutationFn: changePassword });
}

export function useInvitationPreviewQuery(token: string) {
  return useQuery({
    queryKey: queryKeys.invitationPreview(token),
    queryFn: () => previewInvitation(token),
    enabled: token.length > 0,
    retry: false,
  });
}

export function useJoinInvitationMutation(userId: string, token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => joinInvitation(token),
    onSuccess: (result) => {
      if (result.status === "PENDING_APPROVAL") return undefined;
      return queryClient.invalidateQueries({
        queryKey: queryKeys.activitiesCurrent(userId),
      });
    },
  });
}

export function useJoinRequestQuery(userId: string, requestId: string) {
  return useQuery({
    queryKey: queryKeys.joinRequest(userId, requestId),
    queryFn: () => getJoinRequest(requestId),
    enabled: userId.length > 0 && requestId.length > 0,
    retry: false,
  });
}
