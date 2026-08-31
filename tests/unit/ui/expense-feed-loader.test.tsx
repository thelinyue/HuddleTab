// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFeed: vi.fn(),
  getSummary: vi.fn(),
  getContext: vi.fn(),
  feed: vi.fn(),
  replaceSnapshot: vi.fn(),
  listMutations: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: "activity-1" }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/features/expenses/api", () => ({
  getExpenseDetail: vi.fn(),
  getExpenseFeed: mocks.getFeed,
  getExpenseFeedSummary: mocks.getSummary,
  getQuickExpenseContext: mocks.getContext,
  deleteExpense: vi.fn(),
}));
vi.mock("@/features/expenses/components/expense-feed", () => ({
  ExpenseFeed: (props: unknown) => {
    mocks.feed(props);
    return <p>流水已加载</p>;
  },
}));
vi.mock("@/features/expenses/components/expense-detail", () => ({
  ExpenseDetail: () => null,
}));
vi.mock("@/features/expenses/components/expense-edit-overlay", () => ({
  ExpenseEditOverlay: () => null,
}));
vi.mock("@/features/expenses/components/expense-split-detail", () => ({
  ExpenseSplitDetail: () => null,
}));
vi.mock("@/features/pwa/update-banner", () => ({ UpdateBanner: () => null }));
vi.mock("@/pwa/indexed-db/snapshot-repository", () => ({
  SnapshotRepository: {
    open: vi.fn().mockResolvedValue({
      replace: mocks.replaceSnapshot,
      close: vi.fn(),
    }),
  },
}));
vi.mock("@/pwa/indexed-db/mutation-repository", () => ({
  MutationRepository: class {
    listByActivity = mocks.listMutations;
  },
}));
vi.mock("@/pwa/indexed-db/attachment-repository", () => ({
  AttachmentRepository: class {},
}));
vi.mock("@/pwa/sync-queue/sync-triggers", () => ({ SyncTriggers: () => null }));

import { ExpenseFeedLoader } from "@/features/expenses/components/expense-loaders";

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  });
  sessionStorage.clear();
  mocks.getSummary.mockResolvedValue({
    activityName: "周末上海旅行",
    currency: "CNY",
    revision: "1",
    totalExpenseMinor: "0",
    expenseCount: 0,
    participatingMemberCount: 0,
    averageExpenseMinor: "0",
    startDate: "2026-08-29",
    endDate: "2026-08-31",
    memberCount: 4,
    currentUserBalanceMinor: "0",
    originalCurrencyTotals: [],
  });
  mocks.getFeed.mockResolvedValue([]);
  mocks.getContext.mockResolvedValue({
    activity: {
      id: "activity-1",
      baseCurrency: "CNY",
      status: "ACTIVE",
      currentMemberId: "member-1",
      currentUserId: "user-1",
    },
    members: [],
    preference: {
      lastCategory: null,
      recentParticipantIds: [],
      recentPayerIds: [],
      recentCurrency: null,
      recentTitles: [],
    },
    permissions: { canCreateExpense: true, canManageMembers: true },
  });
  mocks.listMutations.mockResolvedValue([]);
  mocks.replaceSnapshot.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("流水加载成功后向工作台回报活动 Header 数据", async () => {
  const onHeaderData = vi.fn();

  render(
    <ExpenseFeedLoader
      timeZone="Asia/Shanghai"
      onHeaderData={onHeaderData}
    />,
  );

  expect(await screen.findByText("流水已加载")).toBeVisible();
  await waitFor(() =>
    expect(onHeaderData).toHaveBeenCalledWith({
      activityId: "activity-1",
      name: "周末上海旅行",
      startDate: "2026-08-29",
      endDate: "2026-08-31",
      memberCount: 4,
      status: "ACTIVE",
    }),
  );
});
