import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
  data: undefined as undefined | {
    activityName: string; balances: Array<{ amountMinor: string; displayName: string; memberId: string; state: "settled" }>;
    currency: string; currentUserBalanceMinor: string; memberCount: number; recommendations: []; state: "empty"; totalExpenseMinor: string;
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

  it("空账本仍显示可导出的摘要卡", () => {
    queryState.data = { activityName: "空活动", balances: [], currency: "CNY", currentUserBalanceMinor: "0", memberCount: 1, recommendations: [], state: "empty", totalExpenseMinor: "0" };
    renderPage();
    expect(screen.getAllByText("还没有账单")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "下载 PNG" })).toBeEnabled();
  });
});
