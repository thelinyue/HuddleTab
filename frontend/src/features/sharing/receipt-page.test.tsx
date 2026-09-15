import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({ data: undefined as any, error: null as unknown, isPending: false, refetch: vi.fn() }));
const exportReceiptCard = vi.hoisted(() => vi.fn().mockResolvedValue({ kind: "downloaded" }));

vi.mock("../auth/api", () => ({ useSessionQuery: () => ({ data: { userId: "user-1" }, isPending: false }) }));
vi.mock("./receipt", async importOriginal => ({ ...(await importOriginal<typeof import("./receipt")>()), useReceiptDataQuery: () => queryState }));
vi.mock("./image-export", () => ({ exportReceiptCard }));

import { ReceiptSharePage } from "./receipt-page";

function makeExpense(expenseId: string, title: string, occurredAt: string) {
  return { expense: { expenseId, title, occurredAt, baseAmountMinor: "1000", originalAmountMinor: "1000", originalCurrency: "CNY", splitMode: "EQUAL" }, payments: [], shares: [], attachments: [] };
}

function renderPage() {
  return render(<MemoryRouter initialEntries={["/share-feed/activity-1"]}><Routes><Route path="/share-feed/:activityId" element={<ReceiptSharePage />} /></Routes></MemoryRouter>);
}

describe("ReceiptSharePage", () => {
  afterEach(() => {
    cleanup();
    queryState.data = undefined;
    queryState.error = null;
    queryState.isPending = false;
    queryState.refetch.mockReset();
    exportReceiptCard.mockReset().mockResolvedValue({ kind: "downloaded" });
  });

  it("可以多选日期并按第 X 天分组预览", () => {
    queryState.data = {
      activity: { activityId: "activity-1", name: "周末聚餐", startDate: "2026-09-10", baseCurrency: "CNY" },
      members: [],
      expenses: [makeExpense("a", "早餐", "2026-09-10T02:00:00.000Z"), makeExpense("b", "晚餐", "2026-09-12T02:00:00.000Z")],
    };
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /流水日期/ }));
    expect(screen.getByText("第 1 天 · 2026-09-10")).toBeInTheDocument();
    expect(screen.queryAllByText("第 3 天 · 2026-09-12")).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: /第 1 天 · 2026-09-10/ }));
    expect(screen.queryAllByText("第 3 天 · 2026-09-12")).toHaveLength(2);
    expect(screen.getByText("早餐")).toBeInTheDocument();
    expect(screen.getByText("晚餐")).toBeInTheDocument();
  });

  it("活动前流水在日期选择器和小票预览中使用同一标签", () => {
    queryState.data = {
      activity: { activityId: "activity-1", name: "国庆旅行", startDate: "2026-10-01", baseCurrency: "CNY" },
      members: [],
      expenses: [makeExpense("flight", "机票", "2026-09-15T04:00:00.000Z"), makeExpense("departure", "出发早餐", "2026-10-01T04:00:00.000Z")],
    };
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /流水日期/ }));
    expect(screen.getByText("活动前 · 2026-09-15")).toBeInTheDocument();
    expect(screen.queryAllByText("第 1 天 · 2026-10-01")).toHaveLength(2);

    fireEvent.click(screen.getByRole("checkbox", { name: /活动前 · 2026-09-15/ }));
    expect(screen.queryAllByText("活动前 · 2026-09-15")).toHaveLength(2);
    expect(screen.getByText("机票")).toBeInTheDocument();
  });

  it("没有选中日期时禁用导出", () => {
    queryState.data = {
      activity: { activityId: "activity-1", name: "周末聚餐", startDate: "2026-09-10", baseCurrency: "CNY" },
      members: [],
      expenses: [makeExpense("a", "早餐", "2026-09-10T02:00:00.000Z")],
    };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /流水日期/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /第 1 天 · 2026-09-10/ }));
    expect(screen.getByRole("button", { name: "分享图片" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存图片" })).toBeDisabled();
    expect(screen.getAllByText("请选择至少一个日期")).toHaveLength(2);
  });

  it("全部流水使用同一选择面板并选中所有日期分组", () => {
    queryState.data = {
      activity: { activityId: "activity-1", name: "周末聚餐", startDate: "2026-09-10", baseCurrency: "CNY" },
      members: [],
      expenses: [makeExpense("a", "早餐", "2026-09-10T02:00:00.000Z"), makeExpense("b", "晚餐", "2026-09-12T02:00:00.000Z")],
    };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /流水日期/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /全部流水/ }));
    expect(screen.getByRole("button", { name: /已选 2 天 · 2 笔流水/ })).toBeInTheDocument();
    expect(screen.getByText("早餐")).toBeInTheDocument();
    expect(screen.getByText("晚餐")).toBeInTheDocument();
  });
});
