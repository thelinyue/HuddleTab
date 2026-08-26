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
  readonly revision: string;
  readonly totalExpenseMinor: string;
  readonly originalCurrencyTotals: readonly {
    readonly currency: string;
    readonly amountMinor: string;
  }[];
}

export interface QuickExpenseContextDto {
  readonly activity: {
    readonly id: string;
    readonly baseCurrency: string;
    readonly currentMemberId: string;
    readonly currentUserId: string;
  };
  readonly members: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly status: "ACTIVE" | "LEFT";
  }[];
  readonly preference: {
    readonly lastCategory: string | null;
    readonly recentParticipantIds: readonly string[];
    readonly recentPayerIds: readonly string[];
    readonly recentCurrency: string | null;
    readonly recentTitles: readonly string[];
  };
  readonly permissions: { readonly canCreateExpense: boolean };
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

/** 保留 HTTP 状态给离线协调器，以区分可重试服务故障和最终业务拒绝。 */
export class ExpenseRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ExpenseRequestError";
  }
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

/** 快速记账只读取必要的活动身份和当前用户偏好，不传输邮箱等账号资料。 */
export function getQuickExpenseContext(activityId: string) {
  return readJson<QuickExpenseContextDto>(
    `/api/activities/${activityId}/expenses/entry-context`,
  );
}

export async function createExpense(
  activityId: string,
  input: import("@/features/expenses/contracts").CreateExpenseRequest,
) {
  const response = await fetch(`/api/activities/${activityId}/expenses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new ExpenseRequestError(
      body.error?.message ?? "消费保存失败，请稍后重试。",
      response.status,
    );
  }
  return (await response.json()).data as {
    readonly expense: ExpenseDetailDto;
    readonly idempotentReplay: boolean;
  };
}
