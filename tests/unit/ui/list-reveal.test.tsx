// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  fromTo: vi.fn(),
  matchMedia: vi.fn(),
  registerPlugin: vi.fn(),
  revert: vi.fn(),
  set: vi.fn(),
  useGSAP: vi.fn(),
}));

vi.mock("@gsap/react", () => ({
  useGSAP: (callback: () => void) => {
    mocks.useGSAP(callback);
    callback();
  },
}));

vi.mock("gsap", () => ({
  gsap: {
    fromTo: mocks.fromTo,
    matchMedia: mocks.matchMedia,
    registerPlugin: mocks.registerPlugin,
    set: mocks.set,
  },
}));

import {
  ListReveal,
  ListRevealItem,
} from "@/components/design-system/list-reveal";

function setMotionPreference(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches:
        query === "(prefers-reduced-motion: reduce)"
          ? reducedMotion
          : !reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  mocks.matchMedia.mockReturnValue({
    add: mocks.add.mockImplementation((query: string, callback: () => void) => {
      if (window.matchMedia(query).matches) callback();
    }),
    revert: mocks.revert,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("公开 ListRevealItem 标记列表项并只将标记项交给 GSAP", () => {
  setMotionPreference(false);
  render(
    <ListReveal>
      <ListRevealItem>第一项</ListRevealItem>
      <p>不参与动画</p>
      <ListRevealItem>第二项</ListRevealItem>
    </ListReveal>,
  );

  expect(screen.getByText("第一项")).toHaveAttribute("data-list-reveal");
  expect(screen.getByText("第二项")).toHaveAttribute("data-list-reveal");
  expect(screen.getByText("不参与动画")).not.toHaveAttribute(
    "data-list-reveal",
  );
  expect(mocks.fromTo).toHaveBeenCalledWith(
    "[data-list-reveal]",
    { autoAlpha: 0, y: 8 },
    {
      autoAlpha: 1,
      y: 0,
      duration: 0.28,
      ease: "power1.out",
      stagger: 0.03,
    },
  );
});

test("减少动态效果时直接将公开列表项置于最终状态", () => {
  setMotionPreference(true);
  render(
    <ListReveal>
      <ListRevealItem>第一项</ListRevealItem>
    </ListReveal>,
  );

  expect(mocks.set).toHaveBeenCalledWith("[data-list-reveal]", {
    autoAlpha: 1,
    y: 0,
  });
  expect(mocks.fromTo).not.toHaveBeenCalled();
});
