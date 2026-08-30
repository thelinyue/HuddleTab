// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { NavigationOverlay } from "@/components/ui/navigation-overlay";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query === "(min-width: 768px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test.each([false, true])(
  "统一导航壳的根视图在%s桌面模式只有一个 Header 和 Close",
  async (wide) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: wide,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    render(
      <NavigationOverlay open onOpenChange={vi.fn()} title="成员">
        <p>成员内容</p>
      </NavigationOverlay>,
    );

    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    expect(screen.queryAllByRole("banner")).toHaveLength(0);
    expect(screen.getAllByRole("heading", { name: "成员" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "关闭" })).toHaveLength(1);
    expect(screen.getByRole("heading").parentElement).toHaveClass(
      "grid",
      "grid-cols-3",
    );
    expect(
      screen.queryByRole("button", { name: /返回/ }),
    ).not.toBeInTheDocument();
  },
);

test("统一导航壳的子视图只有一个 Header、一个 Back 和一个 Close", async () => {
  const onBack = vi.fn();
  const user = userEvent.setup();
  render(
    <NavigationOverlay
      open
      onOpenChange={vi.fn()}
      title="邀请成员"
      onBack={onBack}
      backLabel="成员"
    >
      <p>邀请内容</p>
    </NavigationOverlay>,
  );

  await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
  expect(screen.getAllByRole("heading", { name: "邀请成员" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "返回成员" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "关闭" })).toHaveLength(1);

  await user.click(screen.getByRole("button", { name: "返回成员" }));
  expect(onBack).toHaveBeenCalledTimes(1);
});
