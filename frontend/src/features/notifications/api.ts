import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

export type Notification = components["schemas"]["NotificationData"];
export type NotificationList = components["schemas"]["NotificationListData"];

async function listNotifications(): Promise<NotificationList> {
  return unwrap(await apiClient.GET("/api/notifications")).data;
}

async function markNotificationRead(notificationId: string): Promise<Notification> {
  const headers = await mutationHeaders();
  return unwrap(
    await apiClient.POST("/api/notifications/{notification_id}/read", {
      params: {
        path: { notification_id: notificationId },
        header: { "x-csrf-token": headers["X-CSRF-Token"] },
      },
    }),
  ).data;
}

export function useNotificationsQuery(userId: string) {
  return useQuery({
    queryKey: queryKeys.notifications(userId),
    queryFn: listNotifications,
    enabled: userId.length > 0,
  });
}

export function useMarkNotificationReadMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: (notification) => {
      queryClient.setQueryData<NotificationList>(
        queryKeys.notifications(userId),
        (current) => {
          if (!current) return current;
          const previous = current.items.find(
            (item) => item.notificationId === notification.notificationId,
          );
          return {
            ...current,
            items: current.items.map((item) =>
              item.notificationId === notification.notificationId ? notification : item,
            ),
            unreadCount:
              previous?.readAt === null && notification.readAt !== null
                ? Math.max(0, current.unreadCount - 1)
                : current.unreadCount,
          };
        },
      );
    },
  });
}

async function decideJoinRequest(
  activityId: string,
  requestId: string,
  decision: "APPROVE" | "REJECT",
) {
  const headers = await mutationHeaders();
  return unwrap(
    await apiClient.POST(
      "/api/activities/{activity_id}/join-requests/{join_request_id}",
      {
        params: {
          path: { activity_id: activityId, join_request_id: requestId },
          header: { "x-csrf-token": headers["X-CSRF-Token"] },
        },
        body: { decision },
      },
    ),
  ).data;
}

/** 通知页审批成功后刷新所有受影响的活动读模型；失败时 mutation 不改缓存。 */
export function useDecideNotificationJoinRequestMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, requestId, decision }: {
      activityId: string;
      requestId: string;
      decision: "APPROVE" | "REJECT";
    }) => decideJoinRequest(activityId, requestId, decision),
    onSuccess: (_result, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(userId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.members(userId, variables.activityId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activityDetail(userId, variables.activityId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activitySnapshot(userId, variables.activityId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.joinRequests(userId, variables.activityId) }),
    ]),
  });
}
