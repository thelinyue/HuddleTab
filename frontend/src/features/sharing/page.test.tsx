import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const exportSummaryCard = vi.hoisted(() => vi.fn().mockResolvedValue({ kind: "downloaded" }));

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
    exportSummaryCard.mockReset().mockResolvedValue({ kind: "downloaded" });
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
    expect(screen.getAllByText("当前总消费为零，无需转账")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "下载 PNG" })).toBeEnabled();
  });

  it("下载 PNG 成功后显示准确反馈并清理旧预览", async () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    queryState.data = { activityName: "可下载活动", balances: [], currency: "CNY", currentUserBalanceMinor: "0", memberCount: 1, recommendations: [], state: "zero", totalExpenseMinor: "0", startDate: "2026-08-30", endDate: null, expenseCount: 0, participatingMemberCount: 0, averageExpenseMinor: "0", originalCurrencyTotals: [], categoryTotals: [] };
    exportSummaryCard.mockResolvedValueOnce({ kind: "preview", url: "blob:first", shareFailed: false }).mockResolvedValueOnce({ kind: "downloaded" });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));
    expect(await screen.findByRole("img", { name: /PNG 预览/ })).toHaveAttribute("src", "blob:first");
    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));

    expect(await screen.findByRole("status")).toHaveTextContent("PNG 已开始下载");
    expect(screen.queryByRole("img", { name: /PNG 预览/ })).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
  });

  it("系统文件分享失败时显示可长按保存的原图与恢复提示", async () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    queryState.data = { activityName: "手机活动", balances: [], currency: "CNY", currentUserBalanceMinor: "0", memberCount: 1, recommendations: [], state: "zero", totalExpenseMinor: "0", startDate: "2026-08-30", endDate: null, expenseCount: 0, participatingMemberCount: 0, averageExpenseMinor: "0", originalCurrencyTotals: [], categoryTotals: [] };
    exportSummaryCard.mockResolvedValueOnce({ kind: "preview", url: "blob:mobile", shareFailed: true });
    const view = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("系统分享未能打开");
    expect(screen.getByText(/长按图片即可保存/)).toBeVisible();
    expect(screen.getByRole("link", { name: "打开原图" })).toHaveAttribute("href", "blob:mobile");
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mobile");
  });

  it("生成期间禁用重复操作，取消系统分享后不报错", async () => {
    let finishExport: (result: { kind: "cancelled" }) => void;
    exportSummaryCard.mockImplementationOnce(() => new Promise((resolve) => { finishExport = resolve; }));
    queryState.data = { activityName: "手机活动", balances: [], currency: "CNY", currentUserBalanceMinor: "0", memberCount: 1, recommendations: [], state: "zero", totalExpenseMinor: "0", startDate: "2026-08-30", endDate: null, expenseCount: 0, participatingMemberCount: 0, averageExpenseMinor: "0", originalCurrencyTotals: [], categoryTotals: [] };
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));
    const busyButton = screen.getByRole("button", { name: "正在生成图片…" });
    expect(busyButton).toBeDisabled();
    fireEvent.click(busyButton);
    expect(exportSummaryCard).toHaveBeenCalledOnce();

    finishExport!({ kind: "cancelled" });
    await waitFor(() => expect(screen.getByRole("button", { name: "下载 PNG" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/PNG 已/)).not.toBeInTheDocument();
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
