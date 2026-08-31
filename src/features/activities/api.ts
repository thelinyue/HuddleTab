export interface ActivityHomeItem {
  readonly id: string;
  readonly name: string;
  readonly location?: string | null;
  readonly baseCurrency?: string;
  readonly startDate?: string;
  readonly endDate?: string | null;
  readonly status: "ACTIVE" | "ENDED" | "ARCHIVED";
  readonly memberCount?: number;
  readonly myNetMinor: string;
}

export interface ActivityHomeDto {
  readonly summaries: readonly ActivityCurrencySummary[];
  readonly active: readonly ActivityHomeItem[];
  readonly ended: readonly ActivityHomeItem[];
  readonly archived: readonly ActivityHomeItem[];
}

export interface ActivityFieldPermissions {
  readonly name: boolean;
  readonly location: boolean;
  readonly baseCurrency: boolean;
  readonly startDate: boolean;
  readonly endDate: boolean;
}

export interface ActivityDetailsDto {
  readonly id: string;
  readonly name: string;
  readonly location: string | null;
  readonly baseCurrency: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly status: "ACTIVE" | "ENDED" | "ARCHIVED";
  readonly revision: string;
  readonly currentMemberRole: "OWNER" | "ADMIN" | "MEMBER";
  readonly currentMemberStatus: "ACTIVE" | "LEFT";
  readonly hasAccountingRecords: boolean;
  readonly earliestExpenseDate: string | null;
  readonly permissions: ActivityFieldPermissions;
}

export interface UpdateActivityDetailsInput {
  readonly revision: string;
  readonly name?: string;
  readonly location?: string | null;
  readonly baseCurrency?: string;
  readonly startDate?: string;
  readonly endDate?: string | null;
}

/** 不同活动主币种不能直接运算，因此跨活动摘要按币种保留两个独立方向。 */
export interface ActivityCurrencySummary {
  readonly currency: string;
  readonly payableMinor: string;
  readonly receivableMinor: string;
}

/** 同源 API 客户端只解析稳定 JSON 信封，账务金额仍保持字符串，避免浏览器浮点化。 */
export async function getActivityHome(): Promise<ActivityHomeDto> {
  const response = await fetch("/api/activities", { cache: "no-store" });
  if (!response.ok) throw new Error("活动列表加载失败，请稍后重试。");
  return (await response.json()).data as ActivityHomeDto;
}

async function activityApiError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => undefined)) as
    | { readonly error?: { readonly message?: string } }
    | undefined;
  return new Error(body?.error?.message ?? fallback);
}

export async function getActivityDetails(
  activityId: string,
): Promise<ActivityDetailsDto> {
  const response = await fetch(
    `/api/activities/${encodeURIComponent(activityId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw await activityApiError(
      response,
      "活动信息加载失败，请稍后重试。",
    );
  }
  return (await response.json()).data as ActivityDetailsDto;
}

export async function updateActivityDetails(
  activityId: string,
  input: UpdateActivityDetailsInput,
): Promise<{
  readonly activity: ActivityDetailsDto;
  readonly warnings: readonly string[];
}> {
  const response = await fetch(
    `/api/activities/${encodeURIComponent(activityId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    throw await activityApiError(
      response,
      "活动资料保存失败，请稍后重试。",
    );
  }
  const body = (await response.json()) as {
    readonly data: ActivityDetailsDto;
    readonly warnings?: readonly string[];
  };
  return { activity: body.data, warnings: body.warnings ?? [] };
}
