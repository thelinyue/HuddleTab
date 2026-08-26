"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import {
  getExpenseDetail,
  getExpenseFeed,
  getExpenseFeedSummary,
  type ExpenseDetailResponse,
  type ExpenseFeedSummaryDto,
  type ExpenseListItemDto,
} from "@/features/expenses/api";
import { ExpenseDetail } from "@/features/expenses/components/expense-detail";
import {
  ExpenseFeed,
  type ExpenseFeedFilters,
} from "@/features/expenses/components/expense-feed";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "数据加载失败，请稍后重试。";
}

/** 加载器负责向服务端提交冻结筛选条件，展示组件不以客户端副本冒充权威筛选结果。 */
export function ExpenseFeedLoader() {
  const { activityId } = useParams<{ activityId: string }>();
  const [summary, setSummary] = useState<ExpenseFeedSummaryDto | null>(null);
  const [expenses, setExpenses] = useState<readonly ExpenseListItemDto[]>([]);
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
    void Promise.all([
      getExpenseFeedSummary(activityId),
      getExpenseFeed(activityId, params.size ? `?${params}` : ""),
    ])
      .then(([nextSummary, nextExpenses]) => {
        if (cancelled) return;
        setSummary(nextSummary);
        setExpenses(nextExpenses);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, filters]);
  if (error)
    return (
      <p role="alert" className="py-8 text-destructive">
        {error}
      </p>
    );
  if (!summary)
    return <p className="py-8 text-muted-foreground">正在加载流水…</p>;
  return (
    <ExpenseFeed
      activity={{ id: activityId, name: summary.activityName, ...summary }}
      expenses={expenses}
      onFiltersChange={setFilters}
    />
  );
}

export function ExpenseDetailLoader() {
  const { activityId, expenseId } = useParams<{
    activityId: string;
    expenseId: string;
  }>();
  const [data, setData] = useState<ExpenseDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getExpenseDetail(activityId, expenseId)
      .then((nextData) => {
        if (!cancelled) setData(nextData);
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
  if (!data)
    return <p className="py-8 text-muted-foreground">正在加载消费详情…</p>;
  return <ExpenseDetail data={data} />;
}
