// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
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
vi.mock("gsap/Flip", () => ({ Flip: {} }));

import { QuickExpenseForm } from "@/features/expenses/components/quick-expense-form";

function QuickExpenseHarness(
  props: Omit<ComponentProps<typeof QuickExpenseForm>, "step" | "onStepChange">,
) {
  const [step, setStep] = useState<"ENTRY" | "SPLIT">("ENTRY");
  return <QuickExpenseForm {...props} step={step} onStepChange={setStep} />;
}

const activity = {
  id: "a1",
  baseCurrency: "CNY",
  currentMemberId: "m1",
  currentUserId: "u1",
};
const members = [{ id: "m1", displayName: "小王", status: "ACTIVE" as const }];
const preference = {
  recentParticipantIds: ["m1"],
  recentPayerIds: ["m1"],
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

test("步骤切换使用 scoped GSAP 的可中断位移动画", async () => {
  const user = userEvent.setup();
  setMotionPreference(false);
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "分摊设置" }));

  expect(mocks.fromTo).toHaveBeenLastCalledWith(
    expect.any(HTMLDivElement),
    { opacity: 0.01, x: 12 },
    {
      opacity: 1,
      duration: 0.18,
      ease: "power1.out",
      overwrite: "auto",
      x: 0,
    },
  );
  expect(mocks.useGSAP).toHaveBeenCalledWith(
    expect.any(Function),
    expect.objectContaining({ revertOnUpdate: true, scope: expect.anything() }),
  );
});

test("减少动态效果时步骤直接进入最终状态", () => {
  setMotionPreference(true);
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  expect(mocks.set).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
    opacity: 1,
    scale: 1,
    x: 0,
  });
  expect(mocks.fromTo).not.toHaveBeenCalled();
});
