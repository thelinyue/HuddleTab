import { describe, expect, it } from "vitest";
import type { ExpenseAggregate, ExpenseDraft } from "./api";
import { emptyFeedFilters, feedDateError, feedFilterCount, matchesFeedExpense } from "./feed-filters";

const draft: ExpenseDraft = {
  title: "Coffee 早餐", note: "湖边小店", category: "FOOD", occurredAt: "2026-09-22T16:00:00Z",
  clientMutationId: "m1", originalCurrency: "CNY", originalAmountMinor: "1000", exchangeRate: "1", exchangeRateKind: "IDENTITY",
  payments: [{ memberId: "payer", amountMinor: "600" }, { memberId: "left-member", amountMinor: "400" }],
  split: { mode: "EQUAL", members: ["participant", "left-member"] },
};
const saved: ExpenseAggregate = {
  expense: { ...draft, activityId: "a1", expenseId: "e1", baseCurrency: "CNY", baseAmountMinor: "1000", revision: "1", version: "1", splitMode: "EQUAL", createdAt: draft.occurredAt, updatedAt: draft.occurredAt },
  payments: draft.payments.map(payment => ({ memberId: payment.memberId, factId: payment.memberId, originalAmountMinor: payment.amountMinor, baseAmountMinor: payment.amountMinor })),
  shares: [{ memberId: "participant", factId: "s1", originalAmountMinor: "1000", baseAmountMinor: "1000" }, { memberId: "left-member", factId: "s2", originalAmountMinor: "0", baseAmountMinor: "0" }],
  attachments: [], settlementProgress: { currency: "CNY", members: [], status: "UNSETTLED", remainingMinor: "1000", totalRequiredMinor: "1000", settledMinor: "0" },
};

describe("流水匹配口径", () => {
  it.each(["", "  ", " COFFEE ", "早餐", "湖边"])("搜索用途及备注：%s", query => {
    expect(matchesFeedExpense(saved, emptyFeedFilters(), query, "Asia/Shanghai")).toBe(true);
  });
  it("不把分类或成员姓名混入关键词", () => {
    expect(matchesFeedExpense(saved, emptyFeedFilters(), "FOOD", "Asia/Shanghai")).toBe(false);
  });
  it.each([saved, draft])("已同步数据和本地草稿的并集、交集规则一致", item => {
    const filters = { ...emptyFeedFilters(), categories: ["TRANSPORT", "FOOD"], payerIds: ["other", "left-member"], participantIds: ["participant"] };
    expect(matchesFeedExpense(item, filters, "coffee", "Asia/Shanghai")).toBe(true);
    expect(matchesFeedExpense(item, { ...filters, participantIds: ["payer"] }, "", "Asia/Shanghai")).toBe(false);
    expect(matchesFeedExpense(item, { ...filters, payerIds: ["participant"] }, "", "Asia/Shanghai")).toBe(false);
    expect(matchesFeedExpense(item, { ...filters, categories: ["TRANSPORT"] }, "", "Asia/Shanghai")).toBe(false);
    expect(matchesFeedExpense(item, filters, "没有此用途", "Asia/Shanghai")).toBe(false);
  });
  it.each(["EXACT", "RATIO", "PERCENTAGE"])("%s 分摊草稿从 entries 读取参与人", mode => {
    const item = { ...draft, split: { mode, entries: [{ memberId: "participant", value: "1000" }], members: ["stale"] } };
    expect(matchesFeedExpense(item, { ...emptyFeedFilters(), participantIds: ["participant"] }, "", "UTC")).toBe(true);
    expect(matchesFeedExpense(item, { ...emptyFeedFilters(), participantIds: ["stale"] }, "", "UTC")).toBe(false);
  });
  it("日期与流水分组共用设备时区，包含起止日", () => {
    const filters = { ...emptyFeedFilters(), from: "2026-09-23", to: "2026-09-23" };
    expect(matchesFeedExpense(draft, filters, "", "Asia/Shanghai")).toBe(true);
    expect(matchesFeedExpense(draft, filters, "", "UTC")).toBe(false);
    expect(matchesFeedExpense({ ...draft, occurredAt: "2026-09-23T15:59:59Z" }, filters, "", "Asia/Shanghai")).toBe(true);
    expect(matchesFeedExpense({ ...draft, occurredAt: "2026-09-23T16:00:00Z" }, filters, "", "Asia/Shanghai")).toBe(false);
  });
  it("夏令时切换日按当地自然日匹配", () => {
    const filters = { ...emptyFeedFilters(), from: "2026-11-01", to: "2026-11-01" };
    for (const occurredAt of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z", "2026-11-02T04:59:59Z"]) {
      expect(matchesFeedExpense({ ...draft, occurredAt }, filters, "", "America/New_York")).toBe(true);
    }
    expect(matchesFeedExpense({ ...draft, occurredAt: "2026-11-02T05:00:00Z" }, filters, "", "America/New_York")).toBe(false);
  });
  it("计数按维度而非选项数量", () => {
    expect(feedFilterCount({ categories: ["FOOD", "OTHER"], from: "2026-09-23", to: "2026-09-24", payerIds: ["a", "b"], participantIds: ["c"] })).toBe(4);
    expect(feedFilterCount(emptyFeedFilters())).toBe(0);
  });
});

describe("日期草稿校验", () => {
  it.each([["", ""], ["2026-09-23", "2026-09-23"], ["2024-02-29", "2024-03-01"]])("允许完整范围或全部日期 %s %s", (from, to) => {
    expect(feedDateError(from, to)).toBeUndefined();
  });
  it.each([["2026-09-23", ""], ["", "2026-09-23"], ["2026-09-24", "2026-09-23"], ["2026-02-29", "2026-03-01"]])("拒绝不完整、倒序或非法日期 %s %s", (from, to) => {
    expect(feedDateError(from, to)).toBeTruthy();
  });
});
