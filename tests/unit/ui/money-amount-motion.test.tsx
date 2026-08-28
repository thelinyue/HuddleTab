// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fromTo: vi.fn(),
  registerPlugin: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@gsap/react", async () => {
  const { useLayoutEffect } =
    await vi.importActual<typeof import("react")>("react");
  return {
    useGSAP: (callback: () => void) => useLayoutEffect(() => callback()),
  };
});
vi.mock("gsap", () => ({
  gsap: {
    fromTo: mocks.fromTo,
    registerPlugin: mocks.registerPlugin,
    set: mocks.set,
  },
}));
vi.mock("gsap/Flip", () => ({ Flip: {} }));

import { MoneyAmount } from "@/components/design-system/money-amount";

function setMotionPreference(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      matches: reducedMotion,
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("金额首次渲染立即暴露完整格式化文本且不创建补间", () => {
  setMotionPreference(false);
  render(<MoneyAmount currency="CNY" amountMinor={1234n} />);

  expect(screen.getByText("¥12.34")).toBeVisible();
  expect(mocks.fromTo).not.toHaveBeenCalled();
});

test("已渲染金额变化时先提交最终文本，再对同一 scope 创建短补间", () => {
  setMotionPreference(false);
  const { rerender } = render(
    <MoneyAmount currency="CNY" amountMinor={1234n} />,
  );

  rerender(<MoneyAmount currency="CNY" amountMinor={2345n} />);

  const amount = screen.getByText("¥23.45");
  expect(amount).toHaveTextContent("¥23.45");
  expect(mocks.fromTo).toHaveBeenCalledWith(
    amount,
    { opacity: 0.65, y: -2 },
    {
      duration: 0.18,
      ease: "power2.out",
      opacity: 1,
      overwrite: "auto",
      y: 0,
    },
  );

  mocks.fromTo.mockClear();
  rerender(<MoneyAmount currency="CNY" amountMinor={2345n} />);
  expect(mocks.fromTo).not.toHaveBeenCalled();
});

test("减少动态效果时金额变化只同步最终视觉状态", () => {
  setMotionPreference(true);
  const { rerender } = render(
    <MoneyAmount currency="CNY" amountMinor={1234n} />,
  );

  rerender(<MoneyAmount currency="CNY" amountMinor={2345n} />);

  expect(screen.getByText("¥23.45")).toBeVisible();
  expect(mocks.set).toHaveBeenCalledWith(screen.getByText("¥23.45"), {
    opacity: 1,
    y: 0,
  });
  expect(mocks.fromTo).not.toHaveBeenCalled();
});
