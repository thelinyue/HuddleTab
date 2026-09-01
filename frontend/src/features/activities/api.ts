import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

export type Activity = components["schemas"]["ActivityData"];
export type ActivityMember = components["schemas"]["ActivityMemberData"];
export type CreateActivityInput = components["schemas"]["CreateActivityRequest"];
export type UpdateActivityInput = components["schemas"]["UpdateActivityRequest"];
export type ActivityUpdateEnvelope = components["schemas"]["ActivityUpdateEnvelope"];
export type ActivityLifecycleInput = components["schemas"]["ActivityLifecycleRequest"];
export type Invitation = components["schemas"]["InvitationData"];
export type CreatedInvitation = components["schemas"]["CreatedInvitationData"];
export type CreateInvitationInput = components["schemas"]["CreateInvitationRequest"];
export type InvitationIntent =
  | { mode: "link" }
  | { mode: "direct"; targetUsername: string };

/** 将界面邀请意图集中映射为 OpenAPI 请求，避免组件散落协议常量和使用次数规则。 */
export function invitationRequest(intent: InvitationIntent): CreateInvitationInput {
  if (intent.mode === "link") {
    return { kind: "LINK", maxUses: null, targetUsername: null };
  }
  return {
    kind: "DIRECT",
    maxUses: 1,
    targetUsername: intent.targetUsername,
  };
}

async function listActivities(view: "current" | "deleted"): Promise<Activity[]> {
  return unwrap(
    await apiClient.GET("/api/activities", { params: { query: { view } } }),
  ).data;
}

async function getActivity(activityId: string): Promise<Activity> {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}", {
      params: { path: { activity_id: activityId } },
    }),
  ).data;
}

async function createActivity(input: CreateActivityInput): Promise<Activity> {
  return unwrap(
    await apiClient.POST("/api/activities", {
      body: input,
      headers: await mutationHeaders(),
    }),
  ).data;
}

async function updateActivity(activityId: string, input: UpdateActivityInput): Promise<ActivityUpdateEnvelope> {
  return unwrap(
    await apiClient.PUT("/api/activities/{activity_id}", {
      params: { path: { activity_id: activityId } },
      body: input,
      headers: await mutationHeaders(),
    }),
  );
}

async function transitionActivity(activityId: string, input: ActivityLifecycleInput): Promise<Activity> {
  return unwrap(
    await apiClient.POST("/api/activities/{activity_id}/lifecycle", {
      params: { path: { activity_id: activityId } },
      body: input,
      headers: await mutationHeaders(),
    }),
  ).data;
}

async function deleteActivity(activityId: string, version: string): Promise<Activity> {
  return unwrap(
    await apiClient.DELETE("/api/activities/{activity_id}", {
      params: { path: { activity_id: activityId } },
      body: { version },
      headers: await mutationHeaders(),
    }),
  ).data;
}

async function restoreActivity(activityId: string, version: string): Promise<Activity> {
  return unwrap(
    await apiClient.POST("/api/activities/{activity_id}/restore", {
      params: { path: { activity_id: activityId } },
      body: { version },
      headers: await mutationHeaders(),
    }),
  ).data;
}

async function listMembers(activityId: string): Promise<ActivityMember[]> {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}/members", {
      params: { path: { activity_id: activityId } },
    }),
  ).data;
}

async function createGuest(activityId: string, displayName: string) {
  return unwrap(
    await apiClient.POST("/api/activities/{activity_id}/members/guests", {
      params: { path: { activity_id: activityId } },
      body: { displayName },
      headers: await mutationHeaders(),
    }),
  ).data;
}

async function listInvitations(activityId: string): Promise<Invitation[]> {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}/invitations", {
      params: { path: { activity_id: activityId } },
    }),
  ).data;
}

async function createInvitation(
  activityId: string,
  input: CreateInvitationInput,
): Promise<CreatedInvitation> {
  return unwrap(
    await apiClient.POST("/api/activities/{activity_id}/invitations", {
      params: { path: { activity_id: activityId } },
      body: input,
      headers: await mutationHeaders(),
    }),
  ).data;
}

async function revokeInvitation(activityId: string, invitationId: string) {
  return unwrap(
    await apiClient.DELETE(
      "/api/activities/{activity_id}/invitations/{invitation_id}",
      {
        params: { path: { activity_id: activityId, invitation_id: invitationId } },
        headers: await mutationHeaders(),
      },
    ),
  ).data;
}

export function useActivitiesQuery(userId: string) {
  return useQuery({
    queryKey: queryKeys.activitiesCurrent(userId),
    queryFn: () => listActivities("current"),
    enabled: userId.length > 0,
  });
}

export function useDeletedActivitiesQuery(userId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.activitiesDeleted(userId),
    queryFn: () => listActivities("deleted"),
    enabled: enabled && userId.length > 0,
  });
}

export function useActivityQuery(userId: string, activityId: string) {
  return useQuery({
    queryKey: queryKeys.activityDetail(userId, activityId),
    queryFn: () => getActivity(activityId),
    enabled: userId.length > 0 && activityId.length > 0,
  });
}

export function useCreateActivityMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createActivity,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.activitiesCurrent(userId) }),
  });
}

/** 只有删除域操作会改变 deleted list；普通资料和状态更新不应触发 Owner-only 查询。 */
function useActivityManagementInvalidation(userId: string, activityId: string, includeDeleted: boolean) {
  const queryClient = useQueryClient();
  return () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.activityDetail(userId, activityId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activitiesCurrent(userId) }),
      ...(includeDeleted
        ? [queryClient.invalidateQueries({ queryKey: queryKeys.activitiesDeleted(userId) })]
        : []),
    ]);
}

export function useUpdateActivityMutation(userId: string, activityId: string) {
  const invalidate = useActivityManagementInvalidation(userId, activityId, false);
  return useMutation({
    mutationFn: (input: UpdateActivityInput) => updateActivity(activityId, input),
    onSuccess: invalidate,
  });
}

export function useActivityLifecycleMutation(userId: string, activityId: string) {
  const invalidate = useActivityManagementInvalidation(userId, activityId, false);
  return useMutation({
    mutationFn: (input: ActivityLifecycleInput) => transitionActivity(activityId, input),
    onSuccess: invalidate,
  });
}

export function useDeleteActivityMutation(userId: string, activityId: string) {
  const invalidate = useActivityManagementInvalidation(userId, activityId, true);
  return useMutation({
    mutationFn: (version: string) => deleteActivity(activityId, version),
    onSuccess: invalidate,
  });
}

export function useRestoreActivityMutation(userId: string, activityId: string) {
  const invalidate = useActivityManagementInvalidation(userId, activityId, true);
  return useMutation({
    mutationFn: (version: string) => restoreActivity(activityId, version),
    onSuccess: invalidate,
  });
}

export function useMembersQuery(userId: string, activityId: string) {
  return useQuery({
    queryKey: queryKeys.members(userId, activityId),
    queryFn: () => listMembers(activityId),
    enabled: userId.length > 0 && activityId.length > 0,
  });
}

export function useCreateGuestMutation(userId: string, activityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) => createGuest(activityId, displayName),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.members(userId, activityId) }),
  });
}

export function useInvitationsQuery(userId: string, activityId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.invitations(userId, activityId),
    queryFn: () => listInvitations(activityId),
    enabled: enabled && userId.length > 0 && activityId.length > 0,
  });
}

export function useCreateInvitationMutation(userId: string, activityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (intent: InvitationIntent) =>
      createInvitation(activityId, invitationRequest(intent)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.invitations(userId, activityId) }),
  });
}

export function useRevokeInvitationMutation(userId: string, activityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => revokeInvitation(activityId, invitationId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.invitations(userId, activityId) }),
  });
}
