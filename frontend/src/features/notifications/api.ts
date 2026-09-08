import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

export type Notification = components["schemas"]["NotificationData"];
export type NotificationList = components["schemas"]["NotificationListData"];
export type NotificationFilter = components["schemas"]["NotificationFilterData"];

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

async function markAllNotificationsRead(): Promise<NotificationList> {
  const headers = await mutationHeaders();
  return unwrap(
    await apiClient.POST("/api/notifications/read-all", {
      params: { header: { "x-csrf-token": headers["X-CSRF-Token"] } },
    }),
  ).data;
}

async function clearNotifications(filter: NotificationFilter): Promise<NotificationList> {
  const headers = await mutationHeaders();
  return unwrap(
    await apiClient.DELETE("/api/notifications", {
      body: { filter },
      params: { header: { "x-csrf-token": headers["X-CSRF-Token"] } },
    }),
  ).data;
}

async function deleteNotification(notificationId: string): Promise<NotificationList> {
  const headers = await mutationHeaders();
  return unwrap(
    await apiClient.DELETE("/api/notifications/{notification_id}", {
      params: {
        header: { "x-csrf-token": headers["X-CSRF-Token"] },
        path: { notification_id: notificationId },
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

function replaceNotificationList(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  list: NotificationList,
) {
  queryClient.setQueryData(queryKeys.notifications(userId), list);
}

export function useMarkAllNotificationsReadMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: (list) => replaceNotificationList(queryClient, userId, list),
  });
}

export function useClearNotificationsMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearNotifications,
    onSuccess: (list) => replaceNotificationList(queryClient, userId, list),
  });
}

export function useDeleteNotificationMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteNotification,
    onSuccess: (list, notificationId) => {
      // 删除响应可能与并发读取存在短暂顺序差异，客户端先排除已确认删除的行。
      replaceNotificationList(queryClient, userId, {
        ...list,
        items: list.items.filter((item) => item.notificationId !== notificationId),
      });
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
