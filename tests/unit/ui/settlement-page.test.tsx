// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { SettlementPage } from "@/features/settlements/components/settlement-page";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const data = {
  activity: {
    id: "activity-1",
    name: "大阪旅行",
    currency: "CNY",
    status: "ACTIVE" as const,
    currentMemberId: "m1",
    currentMemberStatus: "ACTIVE" as const,
    currentMemberRole: "MEMBER" as const,
  },
  members: [
    { id: "m1", displayName: "小王", status: "ACTIVE" as const },
    { id: "m2", displayName: "小李", status: "ACTIVE" as const },
  ],
  balances: [
    { memberId: "m1", netMinor: "-32650" },
    { memberId: "m2", netMinor: "32650" },
  ],
  recommendations: [
    { payerMemberId: "m1", receiverMemberId: "m2", amountMinor: "32650" },
  ],
  settlements: [],
};

test("结算总览显示本人结果，并在记录页签中单独展示实际历史", async () => {
  const user = userEvent.setup();
  render(
    <SettlementPage
      data={{
        ...data,
        settlements: [
          {
            id: "s1",
            payerMemberId: "m1",
            receiverMemberId: "m2",
            amountMinor: "32650",
            currency: "CNY",
            occurredAt: "2026-08-27T08:00:00.000Z",
            note: "已转账",
          },
        ],
      }}
      createSettlement={vi.fn()}
    />,
  );

  const overviewTab = screen.getByRole("tab", { name: "总览" });
  const historyTab = screen.getByRole("tab", { name: "记录" });
  expect(overviewTab).toHaveAttribute("aria-selected", "true");
  expect(
    document.getElementById(overviewTab.getAttribute("aria-controls")!),
  ).toBeInTheDocument();
  expect(
    document.getElementById(historyTab.getAttribute("aria-controls")!),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "我的结算结果" })).toBeVisible();
  expect(screen.getAllByText("-¥326.50")[0]).toBeVisible();
  expect(screen.getByText(/已转账/)).not.toBeVisible();

  await user.click(screen.getByRole("tab", { name: "记录" }));
  expect(screen.getByRole("tab", { name: "记录" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByText(/已转账/)).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "我的结算结果" }),
  ).not.toBeInTheDocument();
});

test("结算页签使用 roving tabIndex，并支持键盘切换和聚焦", async () => {
  const user = userEvent.setup();
  render(<SettlementPage data={data} createSettlement={vi.fn()} />);

  const overviewTab = screen.getByRole("tab", { name: "总览" });
  const historyTab = screen.getByRole("tab", { name: "记录" });
  expect(overviewTab).toHaveAttribute("tabindex", "0");
  expect(historyTab).toHaveAttribute("tabindex", "-1");

  overviewTab.focus();
  await user.keyboard("{ArrowRight}");
  expect(historyTab).toHaveFocus();
  expect(historyTab).toHaveAttribute("aria-selected", "true");
  expect(historyTab).toHaveAttribute("tabindex", "0");
  expect(overviewTab).toHaveAttribute("tabindex", "-1");

  await user.keyboard("{Home}");
  expect(overviewTab).toHaveFocus();
  expect(overviewTab).toHaveAttribute("aria-selected", "true");

  await user.keyboard("{End}");
  expect(historyTab).toHaveFocus();
  await user.keyboard("{ArrowLeft}");
  expect(overviewTab).toHaveFocus();
});

test("推荐只预填表单，超额需要明确二次确认", async () => {
  const user = userEvent.setup();
  const createSettlement = vi
    .fn()
    .mockRejectedValueOnce({
      code: "OVER_SETTLEMENT_CONFIRMATION_REQUIRED",
      message: "本次支付比当前应付多 ¥73.50，保存后可能产生新的反向余额",
      details: { overAmountMinor: "7350" },
    })
    .mockResolvedValueOnce({ settlement: { id: "s1" } });
  render(<SettlementPage data={data} createSettlement={createSettlement} />);

  await user.click(screen.getByRole("button", { name: "按建议记录" }));
  expect(screen.getByLabelText("金额")).toHaveValue("326.50");
  expect(createSettlement).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("金额"));
  await user.type(screen.getByLabelText("金额"), "400");
  await user.click(screen.getByRole("button", { name: "确认已支付" }));

  expect(
    await screen.findByRole("alertdialog", { name: "确认超额结算" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "仍然记录 ¥400.00" }));
  expect(createSettlement).toHaveBeenLastCalledWith(
    expect.objectContaining({ confirmOverSettlement: true }),
  );
});

test("LEFT 成员付款人固定为自己，ARCHIVED 不显示记账入口", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <SettlementPage
      data={{
        ...data,
        activity: {
          ...data.activity,
          currentMemberStatus: "LEFT",
        },
        members: [
          ...data.members,
          { id: "m3", displayName: "老陈", status: "LEFT" },
        ],
      }}
      createSettlement={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "记录结算" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "记录结算" }));
  expect(screen.getByLabelText("付款人")).toBeDisabled();
  expect(screen.getByLabelText("付款人")).toHaveValue("m1");
  expect(screen.getByRole("option", { name: "老陈（已退出）" })).toBeVisible();

  rerender(
    <SettlementPage
      data={{ ...data, activity: { ...data.activity, status: "ARCHIVED" } }}
      createSettlement={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "记录结算" }),
  ).not.toBeInTheDocument();
});
