// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addGuestMember: vi.fn(),
  createExpense: vi.fn(),
  enqueueExpense: vi.fn(),
  fromTo: vi.fn(),
  registerPlugin: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@/features/expenses/api", () => ({
  addGuestMember: mocks.addGuestMember,
  createExpense: mocks.createExpense,
}));
vi.mock("@/pwa/sync-queue/enqueue-expense", () => ({
  enqueueExpense: mocks.enqueueExpense,
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
  mocks.createExpense.mockReset();
  mocks.enqueueExpense.mockReset();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("在线保存成功后下一笔默认使用刚提交的分类", async () => {
  const user = userEvent.setup();
  setMotionPreference(true);
  mocks.createExpense.mockResolvedValue({
    expense: { id: "expense-1", title: "地铁" },
  });
  render(
    <QuickExpenseTrigger
      context={{
        ...context,
        preference: { ...context.preference, lastCategory: "OTHER" },
      }}
      timeZone="Asia/Shanghai"
      onSaved={vi.fn()}
    />,
  );

  const trigger = screen.getByRole("button", { name: "记一笔" });
  await user.click(trigger);
  await user.type(screen.getByLabelText("金额", { exact: true }), "12");
  await user.type(screen.getByLabelText("用途"), "地铁");
  await user.click(screen.getByRole("button", { name: "分类" }));
  await user.click(
    within(screen.getByRole("radiogroup", { name: "分类" })).getByRole(
      "radio",
      { name: "交通" },
    ),
  );
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );

  await user.click(trigger);
  expect(screen.getByRole("button", { name: "分类" })).toHaveTextContent(
    "交通",
  );
});

test("离线入队成功后下一笔默认使用刚提交的分类", async () => {
  const user = userEvent.setup();
  setMotionPreference(true);
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  mocks.enqueueExpense.mockResolvedValue({ mutation: { id: "mutation-1" } });
  render(
    <QuickExpenseTrigger
      context={{
        ...context,
        preference: { ...context.preference, lastCategory: "OTHER" },
      }}
      timeZone="Asia/Shanghai"
      onSaved={vi.fn()}
    />,
  );

  const trigger = screen.getByRole("button", { name: "记一笔" });
  await user.click(trigger);
  await user.type(screen.getByLabelText("金额", { exact: true }), "80");
  await user.type(screen.getByLabelText("用途"), "酒店");
  await user.click(screen.getByRole("button", { name: "分类" }));
  await user.click(
    within(screen.getByRole("radiogroup", { name: "分类" })).getByRole(
      "radio",
      { name: "住宿" },
    ),
  );
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );

  await user.click(trigger);
  expect(screen.getByRole("button", { name: "分类" })).toHaveTextContent(
    "住宿",
  );
});

test("取消或保存失败不会改变下一笔默认分类", async () => {
  const user = userEvent.setup();
  setMotionPreference(true);
  mocks.createExpense.mockRejectedValue(new Error("保存失败"));
  render(
    <QuickExpenseTrigger
      context={{
        ...context,
        preference: { ...context.preference, lastCategory: "OTHER" },
      }}
      timeZone="Asia/Shanghai"
      onSaved={vi.fn()}
    />,
  );

  const trigger = screen.getByRole("button", { name: "记一笔" });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "分类" }));
  await user.click(
    within(screen.getByRole("radiogroup", { name: "分类" })).getByRole(
      "radio",
      { name: "购物" },
    ),
  );
  await user.click(screen.getByRole("button", { name: "关闭" }));
  await user.click(trigger);
  expect(screen.getByRole("button", { name: "分类" })).toHaveTextContent(
    "其他",
  );

  await user.type(screen.getByLabelText("金额", { exact: true }), "20");
  await user.type(screen.getByLabelText("用途"), "纪念品");
  await user.click(screen.getByRole("button", { name: "分类" }));
  await user.click(
    within(screen.getByRole("radiogroup", { name: "分类" })).getByRole(
      "radio",
      { name: "购物" },
    ),
  );
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  await user.click(screen.getByRole("button", { name: "关闭" }));

  await user.click(trigger);
  expect(screen.getByRole("button", { name: "分类" })).toHaveTextContent(
    "其他",
  );
});

test("浮动记账入口按下反馈不阻塞打开表单", async () => {
  const user = userEvent.setup();
  setMotionPreference(false);
  render(
    <QuickExpenseTrigger
      context={context}
      timeZone="Asia/Shanghai"
      onSaved={vi.fn()}
    />,
  );

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
  render(
    <QuickExpenseTrigger
      context={context}
      timeZone="Asia/Shanghai"
      onSaved={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "记一笔" }));

  expect(screen.getByRole("heading", { name: "记一笔" })).toBeVisible();
  expect(screen.getByLabelText("金额", { exact: true })).toBeEnabled();
});

test("快速记账完成分摊步骤后保留输入并给出短反馈", async () => {
  const user = userEvent.setup();
  setMotionPreference(false);
  render(
    <QuickExpenseTrigger
      context={context}
      timeZone="Asia/Shanghai"
      onSaved={vi.fn()}
    />,
  );

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
  render(
    <QuickExpenseTrigger
      context={context}
      timeZone="Asia/Shanghai"
      onSaved={vi.fn()}
    />,
  );

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
  render(
    <QuickExpenseTrigger
      context={context}
      timeZone="Asia/Shanghai"
      onSaved={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "记一笔" }));
  expect(screen.getByLabelText("金额", { exact: true })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "谁参与" }));

  expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
  expect(screen.getByRole("dialog", { name: "谁参与" })).toBeVisible();
  expect(
    screen.queryByLabelText("金额", { exact: true }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "返回快速记账" }));
  expect(screen.getByLabelText("金额", { exact: true })).toBeVisible();
});

test("快速记账参与成员的 Close 关闭整个 Sheet 并恢复入口焦点", async () => {
  const user = userEvent.setup();
  setMotionPreference(true);
  render(
    <QuickExpenseTrigger
      context={context}
      timeZone="Asia/Shanghai"
      onSaved={vi.fn()}
    />,
  );

  const trigger = screen.getByRole("button", { name: "记一笔" });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "谁参与" }));
  await user.click(screen.getByRole("button", { name: "关闭" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("快速记账从添加临时成员返回时先退回付款人再回到根视图", async () => {
  const user = userEvent.setup();
  setMotionPreference(true);
  render(
    <QuickExpenseTrigger
      timeZone="Asia/Shanghai"
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
  render(
    <QuickExpenseTrigger
      context={context}
      timeZone="Asia/Shanghai"
      onSaved={vi.fn()}
    />,
  );

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
