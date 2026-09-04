import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
    data: undefined as undefined | {
      activityName: string; balances: Array<{ amountMinor: string; displayName: string; memberId: string; state: "settled" }>;
      currency: string; currentUserBalanceMinor: string; memberCount: number; recommendations: []; state: "zero"; totalExpenseMinor: string;
      startDate: string; endDate: string | null; expenseCount: number; participatingMemberCount: number; averageExpenseMinor: string;
      originalCurrencyTotals: Array<{ currency: string; amountMinor: string }>;
      categoryTotals: Array<{ category: string; amountMinor: string }>;
    },
  error: null as unknown,
  isPending: false,
  refetch: vi.fn(),
}));
const exportSummaryCard = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../auth/api", () => ({ useSessionQuery: () => ({ data: { userId: "user-1" }, isPending: false }) }));
vi.mock("./adapter", () => ({ useActivitySummaryQuery: () => queryState }));
vi.mock("./image-export", () => ({ exportSummaryCard }));

import { ShareSummaryPage } from "./page";

function renderPage() {
  return render(<MemoryRouter initialEntries={["/share-summary/activity-1"]}><Routes><Route path="/share-summary/:activityId" element={<ShareSummaryPage />} /></Routes></MemoryRouter>);
}

describe("ShareSummaryPage", () => {
  afterEach(() => {
    cleanup();
    queryState.data = undefined;
    queryState.error = null;
    queryState.isPending = false;
    queryState.refetch.mockReset();
  });
  it("摘要加载中显示明确进度", () => {
    queryState.isPending = true;
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("正在生成结算摘要…");
  });

  it("摘要读取失败时提供中文恢复操作", () => {
    queryState.error = new Error("网络异常");
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("无法读取结算摘要，请检查网络后重试。");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(queryState.refetch).toHaveBeenCalledOnce();
  });

  it("零金额摘要仍显示可导出的摘要卡", () => {
    queryState.data = { activityName: "零金额活动", balances: [], currency: "CNY", currentUserBalanceMinor: "0", memberCount: 1, recommendations: [], state: "zero", totalExpenseMinor: "0", startDate: "2026-08-30", endDate: null, expenseCount: 0, participatingMemberCount: 0, averageExpenseMinor: "0", originalCurrencyTotals: [], categoryTotals: [] };
    renderPage();
    expect(screen.getAllByText("结算金额为零")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "下载 PNG" })).toBeEnabled();
  });

  it("支持复制摘要，并在浏览器没有系统分享时回退复制", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText }, share: undefined });
    queryState.data = { activityName: "可分享活动", balances: [], currency: "CNY", currentUserBalanceMinor: "0", memberCount: 1, recommendations: [], state: "zero", totalExpenseMinor: "0", startDate: "2026-08-30", endDate: null, expenseCount: 0, participatingMemberCount: 0, averageExpenseMinor: "0", originalCurrencyTotals: [], categoryTotals: [] };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "复制摘要" }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("摘要已复制");
    fireEvent.click(screen.getByRole("button", { name: "系统分享" }));
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it("系统分享取消不产生错误，真实失败保留页面并显示中文提示", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn() }, share: vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")) });
    queryState.data = { activityName: "可分享活动", balances: [], currency: "CNY", currentUserBalanceMinor: "0", memberCount: 1, recommendations: [], state: "zero", totalExpenseMinor: "0", startDate: "2026-08-30", endDate: null, expenseCount: 0, participatingMemberCount: 0, averageExpenseMinor: "0", originalCurrencyTotals: [], categoryTotals: [] };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "系统分享" }));
    await Promise.resolve();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    Object.assign(navigator, { share: vi.fn().mockRejectedValue(new Error("denied")) });
    fireEvent.click(screen.getByRole("button", { name: "系统分享" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("系统分享失败");
  });
});
