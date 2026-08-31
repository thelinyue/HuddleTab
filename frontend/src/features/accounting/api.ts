import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Activity } from "../activities/api";
import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

export type ExpenseAggregate = components["schemas"]["ExpenseAggregateData"];
export type ExpenseDraft = components["schemas"]["ExpenseDraftRequest"];
export type UpdateExpenseInput = components["schemas"]["UpdateExpenseRequest"];
export type Ledger = components["schemas"]["LedgerData"];
export type Recommendation = components["schemas"]["RecommendationItemData"];
export type Settlement = components["schemas"]["SettlementData"];
export type CreateSettlementInput = components["schemas"]["CreateSettlementRequest"];

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

async function createExpense(activityId: string, input: ExpenseDraft) {
  return unwrap(
    await apiClient.POST("/api/activities/{activity_id}/expenses", {
      params: { path: { activity_id: activityId } },
      body: input,
      headers: await mutationHeaders(),
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

async function getLedger(activityId: string): Promise<Ledger> {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}/ledger", {
      params: { path: { activity_id: activityId } },
    }),
  ).data;
}

async function getRecommendations(activityId: string) {
  return unwrap(
    await apiClient.GET("/api/activities/{activity_id}/recommendations", {
      params: { path: { activity_id: activityId } },
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
    ]);
}

export function useExpensesQuery(userId: string, activityId: string) {
  return useQuery({
    queryKey: queryKeys.expenses(userId, activityId),
    queryFn: () => listExpenses(activityId),
  });
}

export function useExpenseQuery(userId: string, activityId: string, expenseId: string) {
  return useQuery({
    queryKey: queryKeys.expense(userId, activityId, expenseId),
    queryFn: () => getExpense(activityId, expenseId),
  });
}

export function useCreateExpenseMutation(userId: string, activityId: string) {
  const invalidate = useAccountingInvalidation(userId, activityId);
  return useMutation({ mutationFn: (input: ExpenseDraft) => createExpense(activityId, input), onSuccess: invalidate });
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

export function useLedgerQuery(userId: string, activityId: string) {
  return useQuery({ queryKey: queryKeys.ledger(userId, activityId), queryFn: () => getLedger(activityId) });
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

export function useRecommendationsQuery(userId: string, activityId: string) {
  return useQuery({ queryKey: queryKeys.recommendations(userId, activityId), queryFn: () => getRecommendations(activityId) });
}

export function useSettlementsQuery(userId: string, activityId: string) {
  return useQuery({ queryKey: queryKeys.settlements(userId, activityId), queryFn: () => listSettlements(activityId) });
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
