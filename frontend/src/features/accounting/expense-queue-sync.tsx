import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { queryKeys } from "../../api/query-keys";
import { MutationRepository } from "../../pwa/indexed-db/mutation-repository";
import { AttachmentRepository } from "../../pwa/indexed-db/attachment-repository";
import {
  EXPENSE_QUEUE_CHANGED_EVENT,
  activateExpenseQueueUser,
  expenseQueueFor,
  type ExpenseQueueChangedDetail,
} from "./expense-queue";

function authoritativeKeys(userId: string, activityId: string) {
  return [
    queryKeys.expenses(userId, activityId),
    queryKeys.ledger(userId, activityId),
    queryKeys.recommendations(userId, activityId),
    queryKeys.settlements(userId, activityId),
    queryKeys.activityDetail(userId, activityId),
  ];
}

/** 只在页面前台协调本地队列；Service Worker 不执行任何业务写入。 */
export function ExpenseQueueSync({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const deactivate = activateExpenseQueueUser(userId);
    const queue = expenseQueueFor(userId);
    const flush = () => {
      if (navigator.onLine) {
        void queue.flush().catch((error: unknown) => {
          console.error("同步本地账单队列失败。", error);
        });
      }
    };
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<ExpenseQueueChangedDetail>).detail;
      if (detail.userId !== userId) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pendingExpenses(userId, detail.activityId),
      });
      if (detail.status === "PENDING") flush();
      if (detail.status === "SYNCED") {
        for (const queryKey of authoritativeKeys(userId, detail.activityId)) {
          void queryClient.invalidateQueries({ queryKey });
        }
      }
    };

    window.addEventListener("online", flush);
    window.addEventListener(EXPENSE_QUEUE_CHANGED_EVENT, handleChange);
    flush();
    return () => {
      deactivate();
      window.removeEventListener("online", flush);
      window.removeEventListener(EXPENSE_QUEUE_CHANGED_EVENT, handleChange);
    };
  }, [queryClient, userId]);

  return null;
}

export function usePendingExpenseMutations(
  userId: string,
  activityId: string,
) {
  return useQuery({
    queryKey: queryKeys.pendingExpenses(userId, activityId),
    // 仅读取当前用户的 IndexedDB，离线时也要响应队列变更并刷新页面。
    networkMode: "always",
    queryFn: async () => {
      const [mutations, attachments] = await Promise.all([
        new MutationRepository(userId).listByActivity(activityId),
        new AttachmentRepository(userId).listByActivity(activityId),
      ]);
      return mutations.map((mutation) => ({
        ...mutation,
        attachments: attachments.filter(
          (attachment) => attachment.mutationId === mutation.id,
        ),
      }));
    },
    enabled: userId.length > 0 && activityId.length > 0,
  });
}
