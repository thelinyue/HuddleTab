// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { SettlementPage } from "@/features/settlements/components/settlement-page";

afterEach(cleanup);

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
