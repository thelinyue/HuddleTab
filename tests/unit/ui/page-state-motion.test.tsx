// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import Link from "next/link";
import {
  createRef,
  forwardRef,
  useImperativeHandle,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";
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
    useGSAP: (
      callback: () => void,
      config: { dependencies?: DependencyList },
    ) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useLayoutEffect(() => callback(), config.dependencies);
    },
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
vi.mock("@/components/design-system/bottom-navigation", () => ({
  ProductNavigation: () => null,
}));
vi.mock("@/features/me/components/product-theme-sync", () => ({
  ProductThemeSync: ({ children }: { readonly children: ReactNode }) =>
    children,
}));

import ProductLayout from "@/app/(product)/layout";
import { AppFrame } from "@/components/design-system/app-frame";
import { EmptyState } from "@/components/design-system/empty-state";
import { StateNotice } from "@/components/design-system/state-notice";
import { SyncStatus } from "@/components/design-system/sync-status";

function TestIcon(props: {
  readonly className?: string;
  readonly "aria-hidden"?: boolean;
}) {
  return <svg {...props} />;
}

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

interface LoaderHandle {
  showLoadedContent: () => void;
}

const LoaderToContent = forwardRef<LoaderHandle>(
  function LoaderToContent(_props, ref) {
    const [loaded, setLoaded] = useState(false);
    useImperativeHandle(ref, () => ({
      showLoadedContent: () => setLoaded(true),
    }));
    return loaded ? <section>已加载账目</section> : <p>正在加载账目</p>;
  },
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("页面框架只对非交互节点按 DOM 顺序执行 scoped reveal", () => {
  setMotionPreference(false);
  render(
    <AppFrame reveal>
      <h1>活动账本</h1>
      <div>
        <button type="button">记一笔</button>
      </div>
      <Link href="/activities/next">下一页</Link>
      <input aria-label="筛选" />
      <section>最近账目</section>
      <section data-page-reveal="false">活动页工作台</section>
    </AppFrame>,
  );

  const frame = screen.getByTestId("app-frame");
  const button = screen.getByRole("button", { name: "记一笔" });
  const link = screen.getByRole("link", { name: "下一页" });
  const input = screen.getByRole("textbox", { name: "筛选" });
  const targets = [
    screen.getByRole("heading", { name: "活动账本" }),
    button.parentElement,
    screen.getByText("最近账目"),
  ];
  expect(mocks.fromTo).toHaveBeenCalledWith(
    targets,
    { opacity: 0.01, y: 8 },
    {
      duration: 0.28,
      ease: "power1.out",
      opacity: 1,
      stagger: 0.035,
      y: 0,
    },
  );
  const animatedTargets = mocks.fromTo.mock.calls[0]?.[0] as HTMLElement[];
  expect(animatedTargets).not.toContain(button);
  expect(animatedTargets).not.toContain(link);
  expect(animatedTargets).not.toContain(input);
  expect(animatedTargets).not.toContain(screen.getByText("活动页工作台"));
  expect(button).toBeEnabled();
  expect(frame).toContainElement(link);
});

test("减少动态效果时页面框架直接进入最终状态", () => {
  setMotionPreference(true);
  render(
    <AppFrame reveal>
      <h1>活动账本</h1>
      <button type="button">记一笔</button>
    </AppFrame>,
  );

  expect(mocks.set).toHaveBeenCalledWith(
    [screen.getByRole("heading", { name: "活动账本" })],
    { opacity: 1, y: 0 },
  );
  expect(mocks.fromTo).not.toHaveBeenCalled();
});

test("AppFrame 默认不启用 reveal，产品 layout 显式启用", () => {
  setMotionPreference(false);
  const { unmount } = render(
    <AppFrame>
      <section>管理页面内容</section>
    </AppFrame>,
  );

  expect(mocks.fromTo).not.toHaveBeenCalled();
  unmount();
  render(
    <ProductLayout>
      <section>产品页面内容</section>
    </ProductLayout>,
  );

  expect(mocks.fromTo).toHaveBeenCalledWith(
    [screen.getByText("产品页面内容")],
    expect.any(Object),
    expect.any(Object),
  );
});

test("持久 PageReveal 在 loader 替换为真实内容后重放 scoped reveal", async () => {
  setMotionPreference(false);
  const loader = createRef<LoaderHandle>();
  render(
    <AppFrame reveal>
      <LoaderToContent ref={loader} />
    </AppFrame>,
  );
  mocks.fromTo.mockClear();

  act(() => loader.current?.showLoadedContent());

  const content = screen.getByText("已加载账目");
  await waitFor(() =>
    expect(mocks.fromTo).toHaveBeenCalledWith(
      [content],
      expect.any(Object),
      expect.any(Object),
    ),
  );
});

test("持久 PageReveal 在客户端页面内容替换时重放 reveal", async () => {
  setMotionPreference(false);
  const { rerender } = render(
    <AppFrame reveal>
      <section>第一页</section>
    </AppFrame>,
  );
  mocks.fromTo.mockClear();

  rerender(
    <AppFrame reveal>
      <section>第二页</section>
    </AppFrame>,
  );

  const content = screen.getByText("第二页");
  await waitFor(() =>
    expect(mocks.fromTo).toHaveBeenCalledWith(
      [content],
      expect.any(Object),
      expect.any(Object),
    ),
  );
});

test("空状态与同步状态在强调后保留名称和状态文本", () => {
  setMotionPreference(false);
  render(
    <>
      <EmptyState
        icon={TestIcon}
        title="暂无账目"
        description="记下第一笔共同支出。"
        action={<button type="button">记一笔</button>}
      />
      <SyncStatus tone="pending" />
    </>,
  );

  expect(screen.getByRole("region", { name: "暂无账目" })).toBeVisible();
  expect(screen.getByRole("button", { name: "记一笔" })).toBeEnabled();
  expect(screen.getByText("等待同步")).toBeVisible();
  expect(mocks.fromTo).toHaveBeenCalledTimes(2);
});

test("错误通知状态变化只做轻量 reveal，并持续暴露 alert 语义", () => {
  setMotionPreference(false);
  const { rerender } = render(
    <StateNotice tone="info" title="正在同步" description="请稍候" />,
  );

  mocks.fromTo.mockClear();
  rerender(
    <StateNotice tone="error" title="同步失败" description="请稍后重试" />,
  );

  const alert = screen.getByRole("alert", { name: "同步失败" });
  expect(alert).toHaveTextContent("请稍后重试");
  expect(mocks.fromTo).toHaveBeenLastCalledWith(
    alert,
    { opacity: 0.01, y: 4 },
    {
      duration: 0.18,
      ease: "power1.out",
      opacity: 1,
      overwrite: "auto",
      y: 0,
    },
  );
});
