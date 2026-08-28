// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  registerPlugin: vi.fn(),
  set: vi.fn(),
  to: vi.fn(),
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
    registerPlugin: mocks.registerPlugin,
    set: mocks.set,
    to: mocks.to,
  },
}));
vi.mock("gsap/Flip", () => ({ Flip: {} }));

import {
  useMotionGSAP,
  useScopedResize,
} from "@/components/design-system/motion";

function MotionHarness() {
  const scope = useRef<HTMLDivElement>(null);
  useMotionGSAP(
    (reducedMotion) => {
      const target = scope.current;
      if (!target) return;
      if (reducedMotion) {
        mocks.set(target, { autoAlpha: 1, x: 0 });
        return;
      }
      mocks.to(target, { autoAlpha: 1, duration: 0.18, x: 0 });
    },
    { dependencies: [] as const, scope },
  );
  return <div ref={scope}>动效目标</div>;
}

function ResizeHarness({ onResize }: { readonly onResize: () => void }) {
  const scope = useRef<HTMLDivElement>(null);
  useScopedResize(scope, onResize);
  return <div ref={scope}>尺寸目标</div>;
}

function setMotionPreference(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      addEventListener: mocks.addEventListener,
      matches: reducedMotion,
      removeEventListener: mocks.removeEventListener,
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("减少动态效果时基座将 scoped 目标直接写入最终状态", () => {
  setMotionPreference(true);
  render(<MotionHarness />);

  expect(mocks.set).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
    autoAlpha: 1,
    x: 0,
  });
  expect(mocks.to).not.toHaveBeenCalled();
});

test("普通动态偏好下基座只在自身 scope 内创建补间并清理媒体监听", () => {
  setMotionPreference(false);
  const { unmount } = render(<MotionHarness />);

  expect(mocks.to).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
    autoAlpha: 1,
    duration: 0.18,
    x: 0,
  });
  expect(mocks.addEventListener).toHaveBeenCalledWith(
    "change",
    expect.any(Function),
  );

  unmount();
  expect(mocks.removeEventListener).toHaveBeenCalledWith(
    "change",
    expect.any(Function),
  );
});

test("尺寸监听在 rerender 后调用最新回调，并在卸载后清理", () => {
  const firstResize = vi.fn();
  const latestResize = vi.fn();
  const { rerender, unmount } = render(
    <ResizeHarness onResize={firstResize} />,
  );

  rerender(<ResizeHarness onResize={latestResize} />);
  window.dispatchEvent(new Event("resize"));

  expect(firstResize).not.toHaveBeenCalled();
  expect(latestResize).toHaveBeenCalledTimes(1);

  unmount();
  window.dispatchEvent(new Event("resize"));
  expect(latestResize).toHaveBeenCalledTimes(1);
});
