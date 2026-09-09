import { describe, expect, it } from 'vitest';
import { paginateSummary, type SummaryItem } from './pagination';

describe('实测行高分页', () => {
  it('跨栏目和长行换页后，所有条目恰好出现一次且每页计入栏目标题', () => {
    const items: SummaryItem[] = Array.from({ length: 12 }, (_, index) => ({ key: String(index), kind: index < 5 ? 'transfer' : 'balance', index }));
    const heights = new Map(items.map(item => [item.key, item.index === 4 ? 90 : 30]));
    const pages = paginateSummary(items, heights, 150, 28);
    expect(pages.flat()).toEqual(items);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const height = page.reduce((sum, item, index) => sum + heights.get(item.key)! + (page[index - 1]?.kind !== item.kind ? 28 : 0), 0);
      expect(height).toBeLessThanOrEqual(150);
    }
  });
  it('没有条目仍生成一页；刚好装满不产生空白尾页', () => {
    expect(paginateSummary([], new Map(), 100, 20)).toEqual([[]]);
    const items: SummaryItem[] = [{ key: 'a', kind: 'balance', index: 0 }, { key: 'b', kind: 'balance', index: 1 }];
    expect(paginateSummary(items, new Map([['a', 40], ['b', 40]]), 100, 20)).toEqual([items]);
  });
});
