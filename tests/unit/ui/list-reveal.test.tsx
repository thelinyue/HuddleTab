// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import Link from "next/link";
import type { DependencyList } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  flipFrom: vi.fn(),
  getState: vi.fn(),
  fromTo: vi.fn(),
  matchMedia: vi.fn(),
  registerPlugin: vi.fn(),
  revert: vi.fn(),
  set: vi.fn(),
  useGSAP: vi.fn(),
}));

vi.mock("@gsap/react", async () => {
  const { useLayoutEffect } =
    await vi.importActual<typeof import("react")>("react");
  return {
    useGSAP: (
      callback: () => void,
      config: { dependencies?: DependencyList },
    ) => {
      mocks.useGSAP(callback, config);
      useLayoutEffect(() => callback(), config.dependencies);
    },
  };
});

vi.mock("gsap", () => ({
  gsap: {
    fromTo: mocks.fromTo,
    matchMedia: mocks.matchMedia,
    registerPlugin: mocks.registerPlugin,
    set: mocks.set,
  },
}));
vi.mock("gsap/Flip", () => ({
  Flip: {
    from: mocks.flipFrom,
    getState: mocks.getState,
  },
}));

import {
  ListReveal,
  ListRevealItem,
} from "@/components/design-system/list-reveal";

function setMotionPreference(reducedMotion: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches:
        query === "(prefers-reduced-motion: reduce)"
          ? reducedMotion
          : !reducedMotion,
      addEventListener: (_: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        listeners.delete(listener),
    })),
  );
  mocks.matchMedia.mockReturnValue({
    add: mocks.add.mockImplementation((query: string, callback: () => void) => {
      if (window.matchMedia(query).matches) callback();
    }),
    revert: mocks.revert,
  });
  return () => {
    reducedMotion = false;
    for (const listener of listeners) listener();
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("快照边界更新时不触发缺少 componentDidUpdate 的 React 生命周期警告", () => {
  setMotionPreference(false);
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const { rerender } = render(
    <ListReveal>
      <ListRevealItem>第一项</ListRevealItem>
    </ListReveal>,
  );

  rerender(
    <ListReveal>
      <ListRevealItem>第二项</ListRevealItem>
    </ListReveal>,
  );

  expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
    "getSnapshotBeforeUpdate() should be used with componentDidUpdate()",
  );
});

test("公开 ListRevealItem 标记列表项，并将首次入场严格限制在自身容器", () => {
  setMotionPreference(false);
  render(
    <ListReveal>
      <ListRevealItem>
        <Link href="/activities/first">第一项</Link>
      </ListRevealItem>
      <p>不参与动画</p>
      <ListRevealItem>第二项</ListRevealItem>
    </ListReveal>,
  );

  expect(
    screen.getByRole("link", { name: "第一项" }).parentElement,
  ).toHaveAttribute("data-list-reveal");
  expect(screen.getByText("第二项")).toHaveAttribute("data-list-reveal");
  expect(screen.getByText("不参与动画")).not.toHaveAttribute(
    "data-list-reveal",
  );
  expect(mocks.fromTo).toHaveBeenCalledWith(
    expect.arrayContaining([
      screen.getByRole("link", { name: "第一项" }).parentElement,
      screen.getByText("第二项"),
    ]),
    { opacity: 0.01, y: 8 },
    {
      opacity: 1,
      y: 0,
      duration: 0.28,
      ease: "power1.out",
      stagger: 0.03,
    },
  );
  expect(screen.getByRole("link", { name: "第一项" })).toHaveAttribute(
    "href",
    "/activities/first",
  );
});

test("减少动态效果时直接将公开列表项置于最终状态", () => {
  const enableMotion = setMotionPreference(true);
  render(
    <ListReveal>
      <ListRevealItem>第一项</ListRevealItem>
    </ListReveal>,
  );

  expect(mocks.set).toHaveBeenCalledWith(expect.any(Array), {
    opacity: 1,
    y: 0,
  });
  expect(mocks.fromTo).not.toHaveBeenCalled();

  act(enableMotion);
  expect(mocks.fromTo).not.toHaveBeenCalled();
});

test("children 更新时使用提交前列表 DOM 的几何快照运行 Flip", () => {
  setMotionPreference(false);
  mocks.getState.mockImplementation((targets: HTMLElement[]) => ({
    order: targets.map((target) => target.textContent),
    targets,
  }));
  const { rerender } = render(
    <ListReveal>
      <ListRevealItem key="first">第一项</ListRevealItem>
      <ListRevealItem key="second">第二项</ListRevealItem>
    </ListReveal>,
  );

  mocks.flipFrom.mockClear();
  rerender(
    <ListReveal>
      <ListRevealItem key="second">第二项</ListRevealItem>
      <ListRevealItem key="first">第一项</ListRevealItem>
    </ListReveal>,
  );

  expect(mocks.getState).toHaveBeenCalledWith(
    expect.arrayContaining([
      screen.getByText("第一项"),
      screen.getByText("第二项"),
    ]),
  );
  expect(mocks.flipFrom).toHaveBeenCalledWith(
    expect.objectContaining({ order: ["第一项", "第二项"] }),
    expect.objectContaining({ duration: 0.18 }),
  );
  expect(
    Array.from(document.querySelectorAll("[data-list-reveal]")).map(
      (item) => item.textContent,
    ),
  ).toEqual(["第二项", "第一项"]);
  expect(mocks.useGSAP).toHaveBeenLastCalledWith(
    expect.any(Function),
    expect.objectContaining({ revertOnUpdate: true, scope: expect.anything() }),
  );
});

test("减少动态效果恢复后不重放已显示列表的入场或 Flip", () => {
  const enableMotion = setMotionPreference(true);
  mocks.getState.mockImplementation(() => ({ order: ["第一项"] }));
  render(
    <ListReveal>
      <ListRevealItem>第一项</ListRevealItem>
    </ListReveal>,
  );

  mocks.fromTo.mockClear();
  mocks.flipFrom.mockClear();
  act(enableMotion);

  expect(screen.getByText("第一项")).toBeVisible();
  expect(mocks.fromTo).not.toHaveBeenCalled();
  expect(mocks.flipFrom).not.toHaveBeenCalled();
});
