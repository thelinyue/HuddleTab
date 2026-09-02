import type { DBSchema } from "idb";

import type { components } from "../../api/generated/openapi";

export type ActivitySnapshotData =
  components["schemas"]["ActivitySnapshotData"];
export type ExpenseCreateInput = components["schemas"]["ExpenseDraftRequest"];
export type MutationStatus =
  | "PENDING"
  | "SYNCING"
  | "RETRYABLE"
  | "REJECTED"
  | "SYNCED";

export type ActivitySnapshotRecord = {
  userId: string;
  activityId: string;
  etag: string;
  snapshot: ActivitySnapshotData;
  fetchedAt: number;
};

export type PendingExpenseMutation = {
  id: string;
  userId: string;
  activityId: string;
  kind: "CREATE_EXPENSE";
  payload: ExpenseCreateInput;
  status: MutationStatus;
  attemptCount: number;
  nextAttemptAt: number;
  lastError?: { code: string; message: string };
  serverExpenseId?: string;
  createdAt: number;
  updatedAt: number;
};

export type PendingAttachment = {
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
};

export type PendingAttachmentDraft = Pick<
  PendingAttachment,
  "id" | "clientAttachmentId" | "fileName" | "mimeType" | "blob"
>;

export interface HuddleTabDb extends DBSchema {
  activity_snapshots: {
    key: string;
    value: ActivitySnapshotRecord;
  };
  pending_mutations: {
    key: string;
    value: PendingExpenseMutation;
    indexes: { "by-activity": string };
  };
  pending_attachments: {
    key: string;
    value: PendingAttachment;
    indexes: { "by-mutation": string };
  };
}
