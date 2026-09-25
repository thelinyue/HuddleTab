import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Activity } from "../activities/api";
import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { ApiRequestError, unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";
import { expenseQueueFor, uploadExpenseAttachment } from "./expense-queue";
import type { PendingAttachmentDraft } from "../../pwa/indexed-db/schema";
export { uploadExpenseAttachment };

export type ExpenseAggregate = components["schemas"]["ExpenseAggregateData"];
export type ExpenseDraft = components["schemas"]["ExpenseDraftRequest"];
export type UpdateExpenseInput = components["schemas"]["UpdateExpenseRequest"];
export type Ledger = components["schemas"]["LedgerData"];
export type Recommendation = components["schemas"]["RecommendationItemData"];
export type RecommendationStrategy = "min_transfers" | "centralized";
export type RecommendationSelection = {
  strategy?: RecommendationStrategy;
  hubMemberId?: string;
};
export type RecommendationResult = components["schemas"]["StrategyRecommendationData"];
export type Settlement = components["schemas"]["SettlementData"];
export type SettlementScope = components["schemas"]["SettlementScope"];
export type SettlementPreview = components["schemas"]["SettlementPreview"];
export type CreateSettlementInput = components["schemas"]["CreateSettlementRequest"];
export type ExchangeRateSuggestion = components["schemas"]["ExchangeRateSuggestionData"];
export type AiCapability = components["schemas"]["AiCapabilityData"];
export type AiExpenseDraft = components["schemas"]["AiExpenseDraftData"];

export async function getAiCapability(activityId: string): Promise<AiCapability> {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}/ai/expense-draft/capabilities", {
      params: { path: { activity_id: activityId } },
    }),
  ).data;
}

export function useAiCapabilityQuery(userId: string, activityId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.aiCapability(userId, activityId),
    queryFn: () => getAiCapability(activityId),
    enabled: enabled && userId.length > 0 && activityId.length > 0,
    retry: false,
    staleTime: 30_000,
  });
}

export async function createAiTextDraft(
  activityId: string,
  text: string,
  signal?: AbortSignal,
): Promise<AiExpenseDraft> {
  const result = await apiClient.POST("/api/activities/{activity_id}/ai/expense-draft/text", {
    params: { path: { activity_id: activityId } },
    body: { text },
    headers: await mutationHeaders(),
    signal,
  });
  if (result.data !== undefined) return result.data.data;
  const retryAfter = result.response.headers.get("Retry-After");
  const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
  throw new ApiRequestError(result.response.status, result.error, retryAfterSeconds);
}

/** 图片只在当前请求的 FormData 中存在；Provider data URL 不进入前端缓存或 IndexedDB。 */
export async function createAiImageDraft(
  activityId: string,
  file: File,
  referenceTime: string,
  signal?: AbortSignal,
): Promise<AiExpenseDraft> {
  const formData = new FormData();
  formData.set("file", file, file.name);
  formData.set("referenceTime", referenceTime);
  const headers = await mutationHeaders();
  const result = await apiClient.POST("/api/activities/{activity_id}/ai/expense-draft/image", {
    params: {
      header: { "x-csrf-token": headers["X-CSRF-Token"] },
      path: { activity_id: activityId },
    },
    body: { file: file.name, referenceTime },
    bodySerializer: () => formData,
    signal,
  });
  if (result.data !== undefined) return result.data.data;
  const retryAfter = result.response.headers.get("Retry-After");
  const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
  throw new ApiRequestError(result.response.status, result.error, retryAfterSeconds);
}

export async function fetchExchangeRateSuggestion(
  activityId: string,
  from: string,
  date: string,
): Promise<ExchangeRateSuggestion> {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}/exchange-rate", {
      params: { path: { activity_id: activityId }, query: { from, date } },
    }),
  ).data;
}

async function listExpenses(activityId: string): Promise<ExpenseAggregate[]> {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}/expenses", {
      params: { path: { activity_id: activityId } },
    }),
  ).data;
}

async function getExpense(activityId: string, expenseId: string): Promise<ExpenseAggregate> {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}/expenses/{expense_id}", {
      params: { path: { activity_id: activityId, expense_id: expenseId } },
    }),
  ).data;
}

async function updateExpense(activityId: string, expenseId: string, input: UpdateExpenseInput) {
  return unwrap(
    await apiClient.PUT("/api/activities/{activity_id}/expenses/{expense_id}", {
      params: { path: { activity_id: activityId, expense_id: expenseId } },
      body: input,
      headers: await mutationHeaders(),
    }),
  ).data;
}

async function deleteExpense(activityId: string, expenseId: string, version: string) {
  return unwrap(
    await apiClient.DELETE("/api/activities/{activity_id}/expenses/{expense_id}", {
      params: { path: { activity_id: activityId, expense_id: expenseId } },
      body: { version },
      headers: await mutationHeaders(),
    }),
  ).data;
}

export async function deleteExpenseAttachment(
  activityId: string,
  expenseId: string,
  attachmentId: string,
) {
  const headers = await mutationHeaders();
  const result = await apiClient.DELETE(
    "/api/activities/{activity_id}/expenses/{expense_id}/attachments/{attachment_id}",
    {
      params: {
        header: { "x-csrf-token": headers["X-CSRF-Token"] },
        path: {
          activity_id: activityId,
          expense_id: expenseId,
          attachment_id: attachmentId,
        },
      },
    },
  );
  if (result.response.status !== 204) unwrap(result);
}

async function getLedger(activityId: string): Promise<Ledger> {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}/ledger", {
      params: { path: { activity_id: activityId } },
    }),
  ).data;
}

async function getRecommendations(activityId: string, selection: RecommendationSelection = {}) {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}/recommendations", {
      params: {
        path: { activity_id: activityId },
        query: {
          strategy: selection.strategy,
          hubMemberId: selection.hubMemberId,
        },
      },
    }),
  ).data;
}

async function listSettlements(activityId: string): Promise<Settlement[]> {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}/settlements", {
      params: { path: { activity_id: activityId } },
    }),
  ).data;
}

async function createSettlement(activityId: string, input: CreateSettlementInput) {
  return unwrap(
    await apiClient.POST("/api/activities/{activity_id}/settlements", {
      params: { path: { activity_id: activityId } },
      body: input,
      headers: await mutationHeaders(),
    }),
  ).data;
}

async function updateSettlement(
  activityId: string,
  settlementId: string,
  input: components["schemas"]["UpdateSettlementRequest"],
) {
  return unwrap(
    await apiClient.PUT("/api/activities/{activity_id}/settlements/{settlement_id}", {
      params: { path: { activity_id: activityId, settlement_id: settlementId } },
      body: input,
      headers: await mutationHeaders(),
    }),
  ).data;
}

async function voidSettlement(activityId: string, settlementId: string, version: string) {
  return unwrap(
    await apiClient.DELETE("/api/activities/{activity_id}/settlements/{settlement_id}", {
      params: { path: { activity_id: activityId, settlement_id: settlementId } },
      body: { version },
      headers: await mutationHeaders(),
    }),
  ).data;
}

function useAccountingInvalidation(userId: string, activityId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses(userId, activityId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.ledger(userId, activityId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recommendations(userId, activityId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.settlements(userId, activityId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.settlementPreview(userId, activityId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activitySummary(userId, activityId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activityDetail(userId, activityId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activitySnapshot(userId, activityId) }),
    ]);
}

export function useExpensesQuery(userId: string, activityId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.expenses(userId, activityId),
    queryFn: () => listExpenses(activityId),
    enabled: enabled && userId.length > 0 && activityId.length > 0,
  });
}

export function useExpenseQuery(userId: string, activityId: string, expenseId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.expense(userId, activityId, expenseId),
    queryFn: () => getExpense(activityId, expenseId),
    enabled: enabled && userId.length > 0 && activityId.length > 0 && expenseId.length > 0,
  });
}

export function useCreateExpenseMutation(userId: string, activityId: string) {
  return useMutation({
    // 该 mutation 只负责写入本地离线队列，断网时也必须立即执行。
    networkMode: "always",
    mutationFn: ({
      input,
      files = [],
    }: {
      input: ExpenseDraft;
      files?: readonly File[];
    }) => expenseQueueFor(userId).enqueue(activityId, input, files),
  });
}

export function useReviseRejectedExpenseMutation(userId: string) {
  return useMutation({
    networkMode: "always",
    mutationFn: ({
      mutationId,
      payload,
      attachments,
    }: {
      mutationId: string;
      payload: ExpenseDraft;
      attachments: PendingAttachmentDraft[];
    }) => expenseQueueFor(userId).reviseRejected(mutationId, payload, attachments),
  });
}

export function useDiscardPendingExpenseMutation(userId: string) {
  return useMutation({
    networkMode: "always",
    mutationFn: ({ mutationId, activityId }: { mutationId: string; activityId: string }) =>
      expenseQueueFor(userId).discard(mutationId, activityId),
  });
}

export function useExchangeRateSuggestionMutation(activityId: string) {
  return useMutation({
    mutationFn: ({ from, date }: { from: string; date: string }) =>
      fetchExchangeRateSuggestion(activityId, from, date),
  });
}

export function useUpdateExpenseMutation(userId: string, activityId: string, expenseId: string) {
  const queryClient = useQueryClient();
  const invalidate = useAccountingInvalidation(userId, activityId);
  return useMutation({
    mutationFn: (input: UpdateExpenseInput) => updateExpense(activityId, expenseId, input),
    onSuccess: async () => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: queryKeys.expense(userId, activityId, expenseId) });
    },
  });
}

export function useDeleteExpenseMutation(userId: string, activityId: string, expenseId: string) {
  const invalidate = useAccountingInvalidation(userId, activityId);
  return useMutation({ mutationFn: (version: string) => deleteExpense(activityId, expenseId, version), onSuccess: invalidate });
}

export function useDeleteAttachmentMutation(
  userId: string,
  activityId: string,
  expenseId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      deleteExpenseAttachment(activityId, expenseId, attachmentId),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.expense(userId, activityId, expenseId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.expenses(userId, activityId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.activitySnapshot(userId, activityId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.activityDetail(userId, activityId),
      }),
    ]),
  });
}

/**
 * 编辑已有账单时，图片独立于账单字段立即上传；上传成功后刷新所有会展示
 * 图片数量的账单查询，避免用户必须再次打开页面才能看到服务端事实。
 */
export function useUploadAttachmentMutation(
  userId: string,
  activityId: string,
  expenseId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, clientAttachmentId }: { file: File; clientAttachmentId: string }) =>
      uploadExpenseAttachment(activityId, expenseId, {
        id: crypto.randomUUID(),
        clientAttachmentId,
        fileName: file.name,
        mimeType: file.type,
        blob: file,
      }),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.expense(userId, activityId, expenseId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.expenses(userId, activityId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.activitySnapshot(userId, activityId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.activityDetail(userId, activityId),
      }),
    ]),
  });
}

export function useLedgerQuery(userId: string, activityId: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.ledger(userId, activityId), queryFn: () => getLedger(activityId), enabled: enabled && userId.length > 0 && activityId.length > 0 });
}

/** 活动首页批量复用各活动 Ledger query；余额仍由 Rust 计算，首页只做跨活动同币种汇总。 */
export function useActivityLedgersQuery(userId: string, activities: readonly Activity[]) {
  return useQueries({
    queries: activities.map((activity) => ({
      queryKey: queryKeys.ledger(userId, activity.activityId),
      queryFn: () => getLedger(activity.activityId),
      enabled: userId.length > 0,
    })),
  });
}

export function useRecommendationsQuery(
  userId: string,
  activityId: string,
  selection: RecommendationSelection = {},
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.recommendations(userId, activityId, selection.strategy, selection.hubMemberId),
    queryFn: () => getRecommendations(activityId, selection),
    enabled: enabled && userId.length > 0 && activityId.length > 0,
  });
}

export function useSettlementsQuery(userId: string, activityId: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.settlements(userId, activityId), queryFn: () => listSettlements(activityId), enabled: enabled && userId.length > 0 && activityId.length > 0 });
}

/** 日期、时区和策略共同隔离缓存；不使用上一范围数据作为加载占位，避免提交错误金额。 */
export function useSettlementPreviewQuery(userId: string, activityId: string, dates: string[] | null, timeZone: string, selection: RecommendationSelection, enabled = true) {
  const body = { dates: dates ? [...new Set(dates)].sort() : null, timeZone, ...selection };
  return useQuery({
    queryKey: [...queryKeys.settlementPreview(userId, activityId), body],
    queryFn: async ({ signal }) => unwrap(await apiClient.POST("/api/activities/{activity_id}/settlement-preview", { params: { path: { activity_id: activityId } }, body, signal })).data,
    enabled: enabled && Boolean(userId && activityId),
    retry: false,
  });
}

export function useConfirmBillOffsetsMutation(userId: string, activityId: string) {
  const invalidate = useAccountingInvalidation(userId, activityId);
  return useMutation({
    mutationFn: async (body: components["schemas"]["ConfirmBillOffsetsRequest"]) => unwrap(await apiClient.POST("/api/activities/{activity_id}/offset-confirmations", {
      params: { path: { activity_id: activityId } }, body, headers: await mutationHeaders(),
    })).data,
    onSuccess: invalidate,
  });
}

export function useCreateSettlementMutation(userId: string, activityId: string) {
  const invalidate = useAccountingInvalidation(userId, activityId);
  return useMutation({ mutationFn: (input: CreateSettlementInput) => createSettlement(activityId, input), onSuccess: invalidate });
}

export function useUpdateSettlementMutation(userId: string, activityId: string) {
  const invalidate = useAccountingInvalidation(userId, activityId);
  return useMutation({
    mutationFn: ({ settlementId, input }: { settlementId: string; input: components["schemas"]["UpdateSettlementRequest"] }) =>
      updateSettlement(activityId, settlementId, input),
    onSuccess: invalidate,
  });
}

export function useVoidSettlementMutation(userId: string, activityId: string) {
  const invalidate = useAccountingInvalidation(userId, activityId);
  return useMutation({
    mutationFn: ({ settlementId, version }: { settlementId: string; version: string }) =>
      voidSettlement(activityId, settlementId, version),
    onSuccess: invalidate,
  });
}
