import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

export type Activity = components["schemas"]["ActivityData"];
export type ActivityMember = components["schemas"]["ActivityMemberData"];
export type CreateActivityInput = components["schemas"]["CreateActivityRequest"];
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

async function listActivities(): Promise<Activity[]> {
  return unwrap(await apiClient.GET("/api/activities")).data;
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
    queryKey: queryKeys.activities(userId),
    queryFn: listActivities,
    enabled: userId.length > 0,
  });
}

export function useActivityQuery(userId: string, activityId: string) {
  return useQuery({
    queryKey: queryKeys.activity(userId, activityId),
    queryFn: () => getActivity(activityId),
    enabled: userId.length > 0 && activityId.length > 0,
  });
}

export function useCreateActivityMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createActivity,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.activities(userId) }),
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
