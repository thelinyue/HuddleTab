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
