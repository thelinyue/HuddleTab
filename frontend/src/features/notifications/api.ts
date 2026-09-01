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
