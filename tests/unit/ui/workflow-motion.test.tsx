// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { QuickExpenseTrigger } from "@/features/expenses/components/quick-expense-trigger";
import { UpdateBanner } from "@/features/pwa/update-banner";

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

const context = {
  activity: {
    id: "activity-1",
    baseCurrency: "CNY",
    status: "ACTIVE" as const,
    currentMemberId: "member-1",
    currentUserId: "user-1",
  },
  members: [{ id: "member-1", displayName: "小王", status: "ACTIVE" as const }],
  preference: {
    lastCategory: null,
    recentParticipantIds: ["member-1"],
    recentPayerIds: ["member-1"],
    recentCurrency: "CNY",
    recentTitles: [],
  },
  permissions: { canCreateExpense: true, canManageMembers: false },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("浮动记账入口按下反馈不阻塞打开表单", async () => {
  const user = userEvent.setup();
  setMotionPreference(false);
  render(<QuickExpenseTrigger context={context} onSaved={vi.fn()} />);

  const trigger = screen.getByRole("button", { name: "记一笔" });
  await user.click(trigger);

  expect(screen.getByRole("heading", { name: "记一笔" })).toBeVisible();
  expect(screen.getByLabelText("金额", { exact: true })).toBeEnabled();
  const pressCall = mocks.fromTo.mock.calls.find(
    ([, from]) => from && typeof from === "object" && from.scale === 0.92,
  );
  expect(pressCall?.[0]).not.toBe(trigger);
  expect(trigger).toContainElement(pressCall?.[0] as HTMLElement);
});

test("浏览器没有 crypto.randomUUID 时点击记一笔仍能打开表单", async () => {
  const user = userEvent.setup();
  setMotionPreference(true);
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.fill(7);
      return bytes;
    },
  });
  render(<QuickExpenseTrigger context={context} onSaved={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "记一笔" }));

  expect(screen.getByRole("heading", { name: "记一笔" })).toBeVisible();
  expect(screen.getByLabelText("金额", { exact: true })).toBeEnabled();
});

test("快速记账完成分摊步骤后保留输入并给出短反馈", async () => {
  const user = userEvent.setup();
  setMotionPreference(false);
  render(<QuickExpenseTrigger context={context} onSaved={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "记一笔" }));
  const amount = screen.getByLabelText("金额", { exact: true });
  await user.type(amount, "88.00");
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  await user.click(screen.getByRole("button", { name: "完成" }));

  expect(screen.getByLabelText("金额", { exact: true })).toHaveValue("88.00");
  expect(mocks.fromTo).toHaveBeenCalledWith(
    expect.objectContaining({ dataset: expect.any(DOMStringMap) }),
    { scale: 0.985 },
    {
      duration: 0.18,
      ease: "power2.out",
      overwrite: "auto",
      scale: 1,
    },
  );
});

test("从分摊步骤返回录入页时不误报完成反馈", async () => {
  const user = userEvent.setup();
  setMotionPreference(false);
  render(<QuickExpenseTrigger context={context} onSaved={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "记一笔" }));
  await user.type(screen.getByLabelText("金额", { exact: true }), "88.00");
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  mocks.fromTo.mockClear();
  await user.click(screen.getByRole("button", { name: "返回快速记账" }));

  expect(screen.getByLabelText("金额", { exact: true })).toHaveValue("88.00");
  expect(mocks.fromTo).not.toHaveBeenCalledWith(
    expect.any(HTMLDivElement),
    { scale: 0.985 },
    expect.any(Object),
  );
});

test("快速记账进入参与成员时不叠加第二个业务 Dialog", async () => {
  const user = userEvent.setup();
  setMotionPreference(true);
  render(<QuickExpenseTrigger context={context} onSaved={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "记一笔" }));
  expect(screen.getByLabelText("金额", { exact: true })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "谁参与" }));

  expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
  expect(screen.getByRole("dialog", { name: "谁参与" })).toBeVisible();
  expect(screen.queryByLabelText("金额", { exact: true })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "返回快速记账" }));
  expect(screen.getByLabelText("金额", { exact: true })).toBeVisible();
});

test("快速记账从添加临时成员返回时先退回付款人再回到根视图", async () => {
  const user = userEvent.setup();
  setMotionPreference(true);
  render(
    <QuickExpenseTrigger
      context={{
        ...context,
        members: [
          ...context.members,
          { id: "member-2", displayName: "小李", status: "ACTIVE" as const },
        ],
        permissions: { canCreateExpense: true, canManageMembers: true },
      }}
      onSaved={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "记一笔" }));
  await user.click(screen.getByRole("button", { name: "谁付款" }));
  await user.click(screen.getByRole("button", { name: "添加临时成员" }));
  expect(screen.getByRole("heading", { name: "添加临时成员" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "返回谁付款" }));
  expect(screen.getByRole("heading", { name: "谁付款" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "返回快速记账" }));
  expect(screen.getByRole("heading", { name: "记一笔" })).toBeVisible();
});

test("快速记账进入分类子视图时隐藏根触发器", async () => {
  const user = userEvent.setup();
  setMotionPreference(true);
  render(<QuickExpenseTrigger context={context} onSaved={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "记一笔" }));
  await user.click(screen.getByRole("button", { name: "分类" }));

  expect(screen.getByRole("heading", { name: "分类" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "分类" }),
  ).not.toBeInTheDocument();
});

test("PWA 更新横幅 reveal 后仍可操作更新按钮", async () => {
  const user = userEvent.setup();
  setMotionPreference(false);
  render(<UpdateBanner waitingOverride />);

  const update = screen.getByRole("button", { name: "立即更新" });
  expect(update).toBeEnabled();
  await user.click(update);
  expect(update).toBeEnabled();
  expect(mocks.fromTo).toHaveBeenCalledWith(
    screen.getByText("有新版本可用。").closest("aside"),
    { opacity: 0.01, y: 4 },
    expect.objectContaining({ duration: 0.18, opacity: 1, y: 0 }),
  );
});
