export interface ExpenseListItemDto {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly originalAmountMinor: string;
  readonly originalCurrency: string;
  readonly baseAmountMinor: string;
  readonly baseCurrency: string;
  readonly occurredAt: string;
  readonly payerSummary?: string | null;
  readonly participantCount?: number | null;
}

export interface ExpenseDetailDto extends ExpenseListItemDto {
  readonly exchangeRate: string;
  readonly exchangeRateSource: string;
  readonly exchangeRateAt: string;
  readonly splitMode: string;
  readonly note: string | null;
  readonly createdByDisplayName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExpenseFeedSummaryDto {
  readonly activityName: string;
  readonly currency: string;
  readonly totalExpenseMinor: string;
  readonly originalCurrencyTotals: readonly {
    readonly currency: string;
    readonly amountMinor: string;
  }[];
}

export interface ExpenseDetailResponse {
  readonly expense: ExpenseDetailDto;
  readonly payments: readonly {
    readonly memberId: string;
    readonly memberDisplayName: string;
    readonly originalAmountMinor: string;
    readonly baseAmountMinor: string;
  }[];
  readonly shares: readonly {
    readonly memberId: string;
    readonly memberDisplayName: string;
    readonly originalAmountMinor: string;
    readonly baseAmountMinor: string;
  }[];
  readonly permissions: {
    readonly canUpdate: boolean;
    readonly canDelete: boolean;
  };
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("数据加载失败，请稍后重试。");
  return (await response.json()).data as T;
}

export function getExpenseFeed(activityId: string, query = "") {
  return readJson<readonly ExpenseListItemDto[]>(
    `/api/activities/${activityId}/expenses${query}`,
  );
}

export function getExpenseFeedSummary(activityId: string) {
  return readJson<ExpenseFeedSummaryDto>(
    `/api/activities/${activityId}/summary`,
  );
}

export function getExpenseDetail(activityId: string, expenseId: string) {
  return readJson<ExpenseDetailResponse>(
    `/api/activities/${activityId}/expenses/${expenseId}`,
  );
}
