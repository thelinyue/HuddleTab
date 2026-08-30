"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  getExpenseDetail,
  getExpenseFeed,
  getExpenseFeedSummary,
  getQuickExpenseContext,
  deleteExpense,
  type ExpenseDetailResponse,
  type ExpenseFeedSummaryDto,
  type ExpenseListItemDto,
  type QuickExpenseContextDto,
} from "@/features/expenses/api";
import { ExpenseDetail } from "@/features/expenses/components/expense-detail";
import { ExpenseEditOverlay } from "@/features/expenses/components/expense-edit-overlay";
import { ExpenseSplitDetail } from "@/features/expenses/components/expense-split-detail";
import {
  ExpenseFeed,
  type ExpenseFeedFilters,
} from "@/features/expenses/components/expense-feed";
import { offlineSessionKey } from "@/features/expenses/components/offline-status";
import { UpdateBanner } from "@/features/pwa/update-banner";
import type { PendingExpenseMutation } from "@/pwa/indexed-db/schema";
import { MutationRepository } from "@/pwa/indexed-db/mutation-repository";
import { AttachmentRepository } from "@/pwa/indexed-db/attachment-repository";
import { SnapshotRepository } from "@/pwa/indexed-db/snapshot-repository";
import { SyncTriggers } from "@/pwa/sync-queue/sync-triggers";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "数据加载失败，请稍后重试。";
}

/** 详情和编辑上下文必须同时刷新，避免下一次编辑继续使用旧版本或旧分摊事实。 */
async function loadExpenseDetailPage(activityId: string, expenseId: string) {
  return Promise.all([
    getExpenseDetail(activityId, expenseId),
    getExpenseFeedSummary(activityId),
    getQuickExpenseContext(activityId),
  ]);
}

type ExpenseFeedSnapshot = {
  readonly summary: ExpenseFeedSummaryDto;
  readonly expenses: readonly ExpenseListItemDto[];
  readonly entryContext: QuickExpenseContextDto;
};

function snapshotUserKey(activityId: string) {
  return `huddletab:expense-feed-user:${activityId}`;
}

/** 在线加载成功后保存完整只读快照；离线消费仍只存在独立 mutation 队列中。 */
async function cacheExpenseFeed(
  activityId: string,
  snapshot: ExpenseFeedSnapshot,
) {
  const userId = snapshot.entryContext.activity.currentUserId;
  const repository = await SnapshotRepository.open(userId);
  try {
    await repository.replace({
      activityId,
      userId,
      revision: snapshot.summary.revision,
      fetchedAt: Date.now(),
      snapshot,
    });
    sessionStorage.setItem(snapshotUserKey(activityId), userId);
  } finally {
    repository.close();
  }
}

/** 离线回退只读取本标签页最近在线身份的缓存，不扫描其他用户的 IndexedDB。 */
async function getCachedExpenseFeed(activityId: string) {
  const userId = sessionStorage.getItem(snapshotUserKey(activityId));
  if (!userId) return undefined;
  const repository = await SnapshotRepository.open(userId);
  try {
    return (await repository.get(activityId))?.snapshot as
      ExpenseFeedSnapshot | undefined;
  } finally {
    repository.close();
  }
}

/** 加载器负责向服务端提交冻结筛选条件，展示组件不以客户端副本冒充权威筛选结果。 */
export function ExpenseFeedLoader({ timeZone }: { readonly timeZone: string }) {
  const { activityId } = useParams<{ activityId: string }>();
  const [summary, setSummary] = useState<ExpenseFeedSummaryDto | null>(null);
  const [expenses, setExpenses] = useState<readonly ExpenseListItemDto[]>([]);
  const [entryContext, setEntryContext] =
    useState<QuickExpenseContextDto | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [highlightedExpenseId, setHighlightedExpenseId] = useState<
    string | null
  >(null);
  const [pendingMutations, setPendingMutations] = useState<
    readonly PendingExpenseMutation[]
  >([]);
  const [filters, setFilters] = useState<ExpenseFeedFilters>({
    query: "",
    category: null,
    mine: false,
  });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (filters.query) params.set("query", filters.query);
    if (filters.category) params.set("category", filters.category);
    if (filters.mine) params.set("mine", "true");
    const restoreCached = async () => {
      const cached = await getCachedExpenseFeed(activityId);
      if (!cached) return false;
      const nextPendingMutations = await new MutationRepository(
        cached.entryContext.activity.currentUserId,
      ).listByActivity(activityId);
      if (cancelled) return true;
      setSummary(cached.summary);
      setExpenses(cached.expenses);
      setEntryContext(cached.entryContext);
      setPendingMutations(nextPendingMutations);
      setError(null);
      return true;
    };
    const load = async () => {
      if (
        !navigator.onLine ||
        sessionStorage.getItem(offlineSessionKey) === "true"
      ) {
        try {
          if (await restoreCached()) return;
          throw new Error("此活动尚未缓存，无法离线查看。");
        } catch (reason) {
          if (!cancelled) setError(errorMessage(reason));
          return;
        }
      }
      try {
        const [nextSummary, nextExpenses, nextEntryContext] = await Promise.all(
          [
            getExpenseFeedSummary(activityId),
            getExpenseFeed(activityId, params.size ? `?${params}` : ""),
            getQuickExpenseContext(activityId),
          ],
        );
        const snapshot = {
          summary: nextSummary,
          expenses: nextExpenses,
          entryContext: nextEntryContext,
        };
        const nextPendingMutations = await new MutationRepository(
          nextEntryContext.activity.currentUserId,
        ).listByActivity(activityId);
        await cacheExpenseFeed(activityId, snapshot);
        if (cancelled) return;
        setSummary(nextSummary);
        setExpenses(nextExpenses);
        setEntryContext(nextEntryContext);
        setPendingMutations(nextPendingMutations);
        setError(null);
      } catch (reason) {
        try {
          if (await restoreCached()) return;
          throw reason;
        } catch {
          if (!cancelled) setError(errorMessage(reason));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activityId, filters, refreshToken]);
  if (error)
    return (
      <p role="alert" className="py-8 text-destructive">
        {error}
      </p>
    );
  if (!summary)
    return <p className="py-8 text-muted-foreground">正在加载流水…</p>;
  const refresh = (expenseId?: string) => {
    if (expenseId) setHighlightedExpenseId(expenseId);
    setRefreshToken((value) => value + 1);
    if (expenseId)
      window.setTimeout(() => setHighlightedExpenseId(null), 3_000);
  };
  const onExpenseQueued = (mutationId: string) => {
    if (!entryContext) return;
    void new MutationRepository(entryContext.activity.currentUserId)
      .get(mutationId)
      .then((mutation) => {
        if (!mutation) return;
        setPendingMutations((current) => [
          mutation,
          ...current.filter((item) => item.id !== mutation.id),
        ]);
      });
  };
  return (
    <>
      {entryContext && (
        <SyncTriggers
          userId={entryContext.activity.currentUserId}
          onCompleted={() => refresh()}
        />
      )}
      <ExpenseFeed
        activity={{ id: activityId, name: summary.activityName, ...summary }}
        expenses={expenses}
        timeZone={timeZone}
        onFiltersChange={setFilters}
        entryContext={entryContext}
        pendingMutations={pendingMutations}
        onDiscardPending={(mutationId) => {
          if (!entryContext) return;
          void new MutationRepository(entryContext.activity.currentUserId)
            .discard(mutationId)
            .then(() =>
              setPendingMutations((current) =>
                current.filter((mutation) => mutation.id !== mutationId),
              ),
            );
        }}
        onRemoveRejectedAttachments={(mutationId) => {
          if (!entryContext) return;
          const userId = entryContext.activity.currentUserId;
          void new AttachmentRepository(userId, async () => ({}))
            .removeRejectedForMutation(mutationId)
            .then(() => new MutationRepository(userId).clearInfo(mutationId))
            .then(() =>
              setPendingMutations((current) =>
                current.map((mutation) =>
                  mutation.id === mutationId
                    ? { ...mutation, syncInfo: undefined }
                    : mutation,
                ),
              ),
            );
        }}
        highlightedExpenseId={highlightedExpenseId}
        onExpenseSaved={refresh}
        onExpenseQueued={onExpenseQueued}
      />
      {entryContext && (
        <>
          <UpdateBanner userId={entryContext.activity.currentUserId} />
        </>
      )}
    </>
  );
}

export function ExpenseDetailLoader({
  timeZone,
}: {
  readonly timeZone: string;
}) {
  const { activityId, expenseId } = useParams<{
    activityId: string;
    expenseId: string;
  }>();
  const router = useRouter();
  const [data, setData] = useState<ExpenseDetailResponse | null>(null);
  const [activityName, setActivityName] = useState<string | null>(null);
  const [context, setContext] = useState<QuickExpenseContextDto | null>(null);
  const [editTarget, setEditTarget] = useState<
    | import("@/features/expenses/components/expense-update").ExpenseEditTarget
    | null
  >(null);
  const editReturnFocusRef = useRef<HTMLElement | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadExpenseDetailPage(activityId, expenseId)
      .then(([nextData, summary, nextContext]) => {
        if (cancelled) return;
        setData(nextData);
        setActivityName(summary.activityName);
        setContext(nextContext);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, expenseId]);
  if (error)
    return (
      <p role="alert" className="py-8 text-destructive">
        {error}
      </p>
    );
  if (!data || !activityName || !context)
    return <p className="py-8 text-muted-foreground">正在加载消费详情…</p>;
  const refreshDetail = async () => {
    const [nextData, summary, nextContext] = await loadExpenseDetailPage(
      activityId,
      expenseId,
    );
    setData(nextData);
    setActivityName(summary.activityName);
    setContext(nextContext);
    setError(null);
  };
  return (
    <>
      <ExpenseDetail
        data={data}
        activityName={activityName}
        timeZone={timeZone}
        onEditTarget={
          data.permissions.canUpdate
            ? (target) => {
                setSaveStatus(null);
                setEditTarget(target);
              }
            : undefined
        }
        editReturnFocusRef={editReturnFocusRef}
        onDelete={
          data.permissions.canDelete
            ? async () => {
                await deleteExpense(
                  activityId,
                  expenseId,
                  data.expense.version,
                );
                router.replace(`/activities/${encodeURIComponent(activityId)}`);
                router.refresh();
              }
            : undefined
        }
      />
      {saveStatus ? (
        <p role="status" aria-live="polite" className="sr-only">
          {saveStatus}
        </p>
      ) : null}
      <ExpenseEditOverlay
        key={editTarget ?? "closed"}
        open={editTarget !== null}
        target={editTarget ?? "TITLE"}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        data={data}
        context={context}
        timeZone={timeZone}
        returnFocusRef={editReturnFocusRef}
        onReloadLatest={refreshDetail}
        onSaved={async () => {
          await refreshDetail();
          setSaveStatus("账单已更新");
        }}
      />
    </>
  );
}

export function ExpenseSplitDetailLoader() {
  const { activityId, expenseId } = useParams<{
    activityId: string;
    expenseId: string;
  }>();
  const [data, setData] = useState<ExpenseDetailResponse | null>(null);
  const [activityName, setActivityName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getExpenseDetail(activityId, expenseId),
      getExpenseFeedSummary(activityId),
    ])
      .then(([nextData, summary]) => {
        if (cancelled) return;
        setData(nextData);
        setActivityName(summary.activityName);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, expenseId]);
  if (error)
    return (
      <p role="alert" className="py-8 text-destructive">
        {error}
      </p>
    );
  if (!data || !activityName)
    return <p className="py-8 text-muted-foreground">正在加载分摊明细…</p>;
  return <ExpenseSplitDetail data={data} activityName={activityName} />;
}
