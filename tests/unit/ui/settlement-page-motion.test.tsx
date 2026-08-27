// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fromTo: vi.fn(),
  set: vi.fn(),
  useGSAP: vi.fn(),
}));

vi.mock("@gsap/react", () => ({
  useGSAP: (callback: () => void, config: unknown) => {
    mocks.useGSAP(callback, config);
    callback();
  },
}));
vi.mock("gsap", () => ({
  gsap: {
    fromTo: mocks.fromTo,
    registerPlugin: vi.fn(),
    set: mocks.set,
  },
}));

import { SettlementPage } from "@/features/settlements/components/settlement-page";

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
  balances: [{ memberId: "m1", netMinor: "-100" }],
  recommendations: [],
  settlements: [
    {
      id: "s1",
      payerMemberId: "m1",
      receiverMemberId: "m2",
      amountMinor: "100",
      currency: "CNY",
      occurredAt: "2026-08-27T08:00:00.000Z",
      note: null,
    },
  ],
};

function setMotionPreference(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("结算页签以 scoped GSAP 动画切换总览和记录", async () => {
  const user = userEvent.setup();
  setMotionPreference(false);
  render(<SettlementPage data={data} createSettlement={vi.fn()} />);

  await user.click(screen.getByRole("tab", { name: "记录" }));

  expect(mocks.fromTo).toHaveBeenLastCalledWith(
    expect.any(HTMLDivElement),
    { autoAlpha: 0, x: 12 },
    expect.objectContaining({
      autoAlpha: 1,
      duration: 0.22,
      overwrite: "auto",
      x: 0,
    }),
  );
  expect(mocks.useGSAP).toHaveBeenCalledWith(
    expect.any(Function),
    expect.objectContaining({ revertOnUpdate: true, scope: expect.anything() }),
  );
});

test("减少动态效果时页签直接显示最终状态", async () => {
  const user = userEvent.setup();
  setMotionPreference(true);
  render(<SettlementPage data={data} createSettlement={vi.fn()} />);
  await user.click(screen.getByRole("tab", { name: "记录" }));

  expect(mocks.set).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
    autoAlpha: 1,
    x: 0,
  });
  expect(mocks.fromTo).not.toHaveBeenCalled();
});
