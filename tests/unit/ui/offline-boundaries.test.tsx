// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExpense: vi.fn(),
  enqueueExpense: vi.fn(),
}));

vi.mock("@/features/expenses/api", () => ({
  createExpense: mocks.createExpense,
}));
vi.mock("@/pwa/sync-queue/enqueue-expense", () => ({
  enqueueExpense: mocks.enqueueExpense,
}));

import { QuickExpenseForm } from "@/features/expenses/components/quick-expense-form";
import { OfflineExpenseStatus } from "@/features/expenses/components/offline-status";
import { SettlementForm } from "@/features/settlements/components/settlement-form";

afterEach(() => {
  cleanup();
  mocks.createExpense.mockReset();
  mocks.enqueueExpense.mockReset();
});

const activity = {
  id: "activity-1",
  baseCurrency: "CNY",
  currentMemberId: "member-1",
  currentUserId: "user-1",
};
const members = [
  { id: "member-1", displayName: "小王", status: "ACTIVE" as const },
];
const settlementContext = {
  activity: {
    id: "activity-1",
    name: "周末露营",
    currency: "CNY",
    status: "ACTIVE" as const,
    currentMemberId: "member-1",
    currentMemberStatus: "ACTIVE" as const,
    currentMemberRole: "MEMBER" as const,
  },
  members,
  balances: [],
  recommendations: [],
};

test("离线时完整消费只入本地队列，不发起网络保存", async () => {
  const user = userEvent.setup();
  mocks.enqueueExpense.mockResolvedValue({ mutation: { id: "mutation-1" } });
  render(
    <QuickExpenseForm
      activity={activity}
      members={members}
      preference={{
        recentParticipantIds: ["member-1"],
        recentPayerIds: ["member-1"],
      }}
      online={false}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "88");
  await user.type(screen.getByLabelText("用途"), "离线午餐");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).not.toHaveBeenCalled();
  expect(mocks.enqueueExpense).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "user-1",
      activityId: "activity-1",
      baseCurrency: "CNY",
    }),
  );
  expect(screen.getByText("已保存到本机，联网后自动同步。")).toBeVisible();
});

test("在线请求发生网络故障时沿用同一账单进入本地队列", async () => {
  const user = userEvent.setup();
  mocks.createExpense.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  mocks.enqueueExpense.mockResolvedValueOnce({
    mutation: { id: "mutation-2" },
  });
  render(
    <QuickExpenseForm
      activity={activity}
      members={members}
      preference={{
        recentParticipantIds: ["member-1"],
        recentPayerIds: ["member-1"],
      }}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "88");
  await user.type(screen.getByLabelText("用途"), "网络故障午餐");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).toHaveBeenCalled();
  expect(mocks.enqueueExpense).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({ title: "网络故障午餐" }),
    }),
  );
});

test("在线时选择附件也先进入原子本地队列，避免账单与附件脱节", async () => {
  const user = userEvent.setup();
  const onSyncRequested = vi.fn();
  window.addEventListener("huddletab:foreground-sync", onSyncRequested);
  mocks.enqueueExpense.mockResolvedValueOnce({
    mutation: { id: "mutation-with-attachment" },
  });
  render(
    <QuickExpenseForm
      activity={activity}
      members={members}
      preference={{
        recentParticipantIds: ["member-1"],
        recentPayerIds: ["member-1"],
      }}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "88");
  await user.type(screen.getByLabelText("用途"), "带附件午餐");
  await user.click(screen.getByRole("button", { name: "更多设置" }));
  await user.upload(
    screen.getByLabelText("附件（最多三张）"),
    new File(["image"], "receipt.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).not.toHaveBeenCalled();
  expect(mocks.enqueueExpense).toHaveBeenCalledWith(
    expect.objectContaining({ files: [expect.any(File)] }),
  );
  expect(onSyncRequested).toHaveBeenCalledOnce();
  window.removeEventListener("huddletab:foreground-sync", onSyncRequested);
});

test("本地入队失败仍显示可读错误", async () => {
  const user = userEvent.setup();
  mocks.enqueueExpense.mockRejectedValueOnce(new Error("本地存储空间不足。"));
  render(
    <QuickExpenseForm
      activity={activity}
      members={members}
      preference={{
        recentParticipantIds: ["member-1"],
        recentPayerIds: ["member-1"],
      }}
      online={false}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "88");
  await user.type(screen.getByLabelText("用途"), "本地失败午餐");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "本地存储空间不足。",
  );
});

test("服务端拒绝的本地消费保留原因，并可明确丢弃本地记录", async () => {
  const user = userEvent.setup();
  const onDiscard = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(
    <OfflineExpenseStatus
      mutation={{
        id: "mutation-1",
        userId: "user-1",
        activityId: "activity-1",
        kind: "CREATE_EXPENSE",
        payload: {
          title: "已结束活动的晚餐",
          originalAmountMinor: "8800",
          originalCurrency: "CNY",
        } as never,
        status: "REJECTED",
        attemptCount: 0,
        nextAttemptAt: Number.MAX_SAFE_INTEGER,
        lastError: {
          code: "ACTIVITY_ENDED",
          message: "活动已经结束，这笔离线消费未同步。",
        },
        createdAt: 0,
        updatedAt: 0,
      }}
      onDiscard={onDiscard}
    />,
  );

  expect(screen.getByText("活动已经结束，这笔离线消费未同步。")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "丢弃本地记录" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(onDiscard).toHaveBeenCalledWith("mutation-1");
  confirm.mockRestore();
});

test("已同步账单可以移除被服务端拒绝的附件", async () => {
  const user = userEvent.setup();
  const onRemoveRejectedAttachments = vi.fn();
  render(
    <OfflineExpenseStatus
      mutation={{
        id: "mutation-1",
        userId: "user-1",
        activityId: "activity-1",
        kind: "CREATE_EXPENSE",
        payload: {
          title: "附件被拒绝的午餐",
          originalAmountMinor: "8800",
          originalCurrency: "CNY",
        } as never,
        status: "SYNCED",
        attemptCount: 0,
        nextAttemptAt: 0,
        syncInfo: {
          code: "ATTACHMENTS_REJECTED",
          message: "有附件被服务器拒绝，请移除后继续。",
        },
        createdAt: 0,
        updatedAt: 0,
      }}
      onDiscard={vi.fn()}
      onRemoveRejectedAttachments={onRemoveRejectedAttachments}
    />,
  );

  await user.click(screen.getByRole("button", { name: "移除被拒绝的附件" }));
  expect(onRemoveRejectedAttachments).toHaveBeenCalledWith("mutation-1");
});

test("离线时不允许记录 Settlement，并明确说明原因", () => {
  render(
    <SettlementForm
      context={settlementContext}
      online={false}
      onSubmit={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "确认已支付" })).toBeDisabled();
  expect(screen.getByText("结算必须联网后记录。")).toBeVisible();
});
