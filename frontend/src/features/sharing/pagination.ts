import type { ShareSummary } from './adapter';

export type SummaryItem = { key: string; kind: 'transfer' | 'balance'; index: number };
export function summaryItems(summary: ShareSummary): SummaryItem[] {
  return [
    ...summary.recommendations.map((_, index) => ({ key: `transfer-${index}`, kind: 'transfer' as const, index })),
    ...summary.balances.map((balance, index) => ({ key: `balance-${balance.memberId}`, kind: 'balance' as const, index })),
  ];
}

/** 使用同宽 DOM 的实际行高分页；每页重新计入栏目标题，不截断或重复任何账务条目。 */
export function paginateSummary(items: readonly SummaryItem[], heights: ReadonlyMap<string, number>, availableHeight: number, headingHeight: number): SummaryItem[][] {
  const pages: SummaryItem[][] = [];
  let page: SummaryItem[] = [];
  let used = 0;
  for (const item of items) {
    let cost = (heights.get(item.key) ?? 32) + (page.at(-1)?.kind !== item.kind ? headingHeight : 0);
    if (page.length && used + cost > availableHeight) { pages.push(page); page = []; used = 0; cost = (heights.get(item.key) ?? 32) + headingHeight; }
    page.push(item); used += cost;
  }
  if (page.length || !pages.length) pages.push(page);
  return pages;
}
