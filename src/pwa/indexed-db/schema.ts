import type { DBSchema } from "idb";
import type { CreateExpenseRequest } from "@/features/expenses/contracts";

export type MutationStatus =
  "PENDING" | "SYNCING" | "RETRYABLE" | "REJECTED" | "SYNCED";
export interface PendingExpenseMutation {
  id: string;
  userId: string;
  activityId: string;
  kind: "CREATE_EXPENSE";
  payload: CreateExpenseRequest;
  status: MutationStatus;
  attemptCount: number;
  nextAttemptAt: number;
  lastError?: { code: string; message: string };
  syncInfo?: { code: string; message: string };
  serverExpenseId?: string;
  createdAt: number;
  updatedAt: number;
}
/** 附件与账单分开保存同步状态，避免附件网络故障导致账单重复创建。 */
export interface PendingAttachment {
  id: string;
  userId: string;
  activityId: string;
  mutationId: string;
  clientAttachmentId: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  status: MutationStatus;
  attemptCount: number;
  nextAttemptAt: number;
  lastError?: { code: string; message: string };
  serverAttachmentId?: string;
  createdAt: number;
  updatedAt: number;
}
export interface HuddleTabDb extends DBSchema {
  activity_snapshots: {
    key: string;
    value: {
      activityId: string;
      userId: string;
      revision: string;
      fetchedAt: number;
      snapshot: unknown;
    };
  };
  activity_preferences: {
    key: string;
    value: { key: string; userId: string; activityId: string; value: unknown };
  };
  pending_mutations: {
    key: string;
    value: PendingExpenseMutation;
    indexes: {
      "by-status-next": [MutationStatus, number];
      "by-activity": string;
    };
  };
  pending_attachments: {
    key: string;
    value: PendingAttachment;
    indexes: {
      "by-mutation": string;
      "by-status-next": [MutationStatus, number];
    };
  };
}
