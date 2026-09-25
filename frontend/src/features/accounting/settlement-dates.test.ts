import { describe, expect, it } from 'vitest';
import type { Settlement } from './api';
import { settlementRecordDates } from './settlement-dates';

function record(fields: Partial<Settlement>) { return fields as Settlement; }

describe('历史结算日期摘要', () => {
  it('使用保存的账单日期，不受范围请求和录入日期影响', () => {
    const result = settlementRecordDates(record({ scopeDates: ['2026-09-22', '2026-09-20'], scopeExpenseIds: ['a', 'b'], createdAt: '2026-09-25T00:00:00Z', scope: { dates: null, timeZone: 'UTC', revision: '1' } }));
    expect(result).toEqual({ dates: ['2026-09-20', '2026-09-22'], summary: '结算 9/20、9/22 · 2 笔' });
  });
  it('跨年保留年份，多日去重后显示天数', () => {
    expect(settlementRecordDates(record({ scopeDates: ['2026-01-01', '2025-12-31'], scopeExpenseIds: ['a', 'b'] })).summary).toBe('结算 2025/12/31、2026/1/1 · 2 笔');
    expect(settlementRecordDates(record({ scopeDates: ['2026-09-20', '2026-09-20', '2026-09-22', '2026-09-24'], scopeExpenseIds: ['a', 'b', 'c', 'd'] })).summary).toBe('结算 3 天 · 4 笔');
  });
  it('旧记录只回退到明确保存的日期，不从录入日期推断', () => {
    expect(settlementRecordDates(record({ createdAt: '2026-09-25T00:00:00Z' })).summary).toBe('未记录日期范围');
    expect(settlementRecordDates(record({ scope: { dates: ['2026-09-20'], timeZone: 'UTC', revision: '1' }, scopeExpenseIds: ['a'] })).summary).toBe('结算 9/20 · 1 笔');
  });
});
