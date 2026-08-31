// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { SettlementForm } from "@/features/settlements/components/settlement-form";

const context = {
  activity: {
    id: "activity-1",
    name: "周末旅行",
    currency: "CNY",
    status: "ACTIVE" as const,
    currentMemberId: "member-1",
    currentMemberRole: "OWNER" as const,
    currentMemberStatus: "ACTIVE" as const,
  },
  members: [
    { id: "member-1", displayName: "小王", status: "ACTIVE" as const },
    { id: "member-2", displayName: "小李", status: "ACTIVE" as const },
  ],
  balances: [],
  recommendations: [],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("结算默认时间和提交瞬间使用部署 TZ", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-31T01:53:00.000Z"));
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <SettlementForm
      context={context}
      timeZone="Pacific/Honolulu"
      onSubmit={onSubmit}
    />,
  );

  expect(screen.getByLabelText("结算时间")).toHaveValue("2026-08-30T15:53");
  fireEvent.change(screen.getByLabelText("收款人"), {
    target: { value: "member-2" },
  });
  fireEvent.change(screen.getByLabelText("金额"), {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认已支付" }));

  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: "2026-08-31T01:53:00.000Z" }),
      "10",
    ),
  );
});
