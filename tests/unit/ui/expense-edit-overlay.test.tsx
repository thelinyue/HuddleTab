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
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addGuestMember: vi.fn(),
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
}));

vi.mock("@/features/expenses/api", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/expenses/api")>();
  return {
    ...original,
    addGuestMember: mocks.addGuestMember,
    createExpense: mocks.createExpense,
    updateExpense: mocks.updateExpense,
  };
});

import {
  ExpenseRequestError,
  type ExpenseDetailResponse,
  type QuickExpenseContextDto,
} from "@/features/expenses/api";
import { ExpenseEditOverlay } from "@/features/expenses/components/expense-edit-overlay";

const context = {
  activity: {
    id: "activity-1",
    baseCurrency: "CNY",
    status: "ACTIVE",
    currentMemberId: "m1",
    currentUserId: "u1",
  },
  members: [
    { id: "m1", displayName: "我", status: "ACTIVE" },
    { id: "m2", displayName: "小王", status: "ACTIVE" },
  ],
  preference: {
    lastCategory: null,
    recentParticipantIds: [],
    recentPayerIds: [],
    recentCurrency: null,
    recentTitles: [],
  },
  permissions: { canCreateExpense: true, canManageMembers: true },
} satisfies QuickExpenseContextDto;

const data = {
  expense: {
    id: "expense-1",
    activityId: "activity-1",
    title: "海底捞火锅",
    category: "FOOD",
    originalAmountMinor: "42800",
    originalCurrency: "CNY",
    baseAmountMinor: "42800",
    baseCurrency: "CNY",
    exchangeRate: "1",
    exchangeRateSource: "IDENTITY",
    exchangeRateAt: "2026-08-27T08:00:00.000Z",
    splitMode: "PERCENTAGE",
    occurredAt: "2026-08-27T08:00:00.000Z",
    note: "朋友聚餐",
    createdByMemberId: "m1",
    createdByDisplayName: "我",
    version: 3,
    createdAt: "2026-08-27T08:03:00.000Z",
    updatedAt: "2026-08-27T08:03:00.000Z",
  },
  payments: [
    {
      memberId: "m1",
      memberDisplayName: "我",
      originalAmountMinor: "42800",
      baseAmountMinor: "42800",
    },
  ],
  shares: [
    {
      memberId: "m1",
      memberDisplayName: "我",
      splitInputMinor: "2500",
      originalAmountMinor: "10700",
      baseAmountMinor: "10700",
    },
    {
      memberId: "m2",
      memberDisplayName: "小王",
      splitInputMinor: "7500",
      originalAmountMinor: "32100",
      baseAmountMinor: "32100",
    },
  ],
  attachments: [],
  permissions: { canUpdate: true, canDelete: true },
} satisfies ExpenseDetailResponse;

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  mocks.updateExpense.mockResolvedValue({
    id: "expense-1",
    title: "海底捞火锅",
    baseAmountMinor: "42800",
    baseCurrency: "CNY",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("标题字段使用现有事实预填，并携带版本提交完整更新", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  render(
    <ExpenseEditOverlay
      open
      target="TITLE"
      onOpenChange={vi.fn()}
      onSaved={onSaved}
      timeZone="Asia/Shanghai"
      context={context}
      data={data}
    />,
  );

  expect(
    await screen.findByRole("heading", { name: "编辑标题" }),
  ).toBeVisible();
  const title = screen.getByLabelText("标题");
  expect(title).toHaveValue("海底捞火锅");
  await user.clear(title);
  await user.type(title, "修改后的火锅");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.updateExpense).toHaveBeenCalledWith(
    "activity-1",
    "expense-1",
    expect.objectContaining({
      version: 3,
      title: "修改后的火锅",
      originalAmountMinor: "42800",
      split: {
        mode: "PERCENTAGE",
        entries: [
          { memberId: "m1", value: "2500" },
          { memberId: "m2", value: "7500" },
        ],
      },
    }),
  );
  expect(onSaved).toHaveBeenCalledOnce();
  expect(mocks.createExpense).not.toHaveBeenCalled();
});

test("分类字段选择后立即提交完整更新", async () => {
  const user = userEvent.setup();
  render(
    <ExpenseEditOverlay
      open
      target="CATEGORY"
      onOpenChange={vi.fn()}
      onSaved={vi.fn()}
      timeZone="Asia/Shanghai"
      context={context}
      data={data}
    />,
  );

  const dialog = await screen.findByRole("dialog", { name: "编辑分类" });
  await user.click(within(dialog).getByRole("radio", { name: "娱乐" }));
  await waitFor(() => expect(mocks.updateExpense).toHaveBeenCalledOnce());

  expect(mocks.updateExpense).toHaveBeenCalledWith(
    "activity-1",
    "expense-1",
    expect.objectContaining({ category: "ENTERTAINMENT" }),
  );
});

test("编辑付款人时可添加临时成员并立即选中", async () => {
  const user = userEvent.setup();
  mocks.addGuestMember.mockResolvedValue({
    id: "guest-1",
    displayName: "阿岚",
    status: "ACTIVE",
    avatarPreset: null,
  });
  render(
    <ExpenseEditOverlay
      open
      target="PAYMENTS"
      onOpenChange={vi.fn()}
      onSaved={vi.fn()}
      timeZone="Asia/Shanghai"
      context={context}
      data={data}
    />,
  );

  await user.click(await screen.findByRole("button", { name: "谁付款" }));
  await user.click(screen.getByRole("button", { name: "添加临时成员" }));
  await user.type(screen.getByLabelText("临时成员昵称"), "阿岚");
  await user.click(screen.getByRole("button", { name: "确认添加" }));

  expect(mocks.addGuestMember).toHaveBeenCalledWith("activity-1", "阿岚");
  await waitFor(() =>
    expect(
      document.querySelector(
        '[data-overlay-body="scroll"] button[aria-label="谁付款"]',
      ),
    ).toHaveTextContent("阿岚"),
  );
});

test("版本冲突时保留用户输入，并可退出编辑查看最新内容", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  mocks.updateExpense.mockRejectedValueOnce(
    new ExpenseRequestError("账单版本冲突。", 409),
  );
  render(
    <ExpenseEditOverlay
      open
      target="TITLE"
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      timeZone="Asia/Shanghai"
      context={context}
      data={data}
    />,
  );

  const title = await screen.findByLabelText("标题");
  await user.clear(title);
  await user.type(title, "修改后的聚餐");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("当前输入已保留");
  expect(title).toHaveValue("修改后的聚餐");
  await user.click(screen.getByRole("button", { name: "查看最新内容" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onSaved).toHaveBeenCalledOnce();
});

test("编辑协调器按目标打开标题 Sheet，而不是完整编辑账单表单", async () => {
  render(
    <ExpenseEditOverlay
      open
      target="TITLE"
      onOpenChange={vi.fn()}
      onSaved={vi.fn()}
      timeZone="Asia/Shanghai"
      context={context}
      data={data}
    />,
  );

  expect(
    await screen.findByRole("heading", { name: "编辑标题" }),
  ).toBeVisible();
  expect(screen.getByLabelText("标题")).toHaveValue("海底捞火锅");
  expect(screen.queryByLabelText("金额")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存" })).toBeVisible();
});

test("分类选择后立即提交完整 PUT 草稿并携带版本与新 mutation id", async () => {
  const user = userEvent.setup();
  render(
    <ExpenseEditOverlay
      open
      target="CATEGORY"
      onOpenChange={vi.fn()}
      onSaved={vi.fn()}
      timeZone="Asia/Shanghai"
      context={context}
      data={data}
    />,
  );

  const dialog = await screen.findByRole("dialog", { name: "编辑分类" });
  expect(
    within(dialog).queryByRole("button", { name: "分类" }),
  ).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("radio", { name: "娱乐" }));

  await waitFor(() => expect(mocks.updateExpense).toHaveBeenCalledOnce());
  const request = mocks.updateExpense.mock.calls[0]?.[2];
  expect(request).toMatchObject({
    version: 3,
    category: "ENTERTAINMENT",
    title: "海底捞火锅",
    originalAmountMinor: "42800",
    payments: [{ memberId: "m1", amountMinor: "42800" }],
    split: {
      mode: "PERCENTAGE",
      entries: [
        { memberId: "m1", value: "2500" },
        { memberId: "m2", value: "7500" },
      ],
    },
  });
  expect(request.clientMutationId).toEqual(expect.any(String));
});

test("金额字段调用系统数字键盘并保留显式保存", async () => {
  render(
    <ExpenseEditOverlay
      open
      target="AMOUNT"
      onOpenChange={vi.fn()}
      onSaved={vi.fn()}
      timeZone="Asia/Shanghai"
      context={context}
      data={data}
    />,
  );

  const amount = await screen.findByLabelText("金额");
  expect(amount).toHaveAttribute("type", "text");
  expect(amount).toHaveAttribute("inputmode", "decimal");
  expect(amount).toHaveAttribute("enterkeyhint", "done");
  expect(screen.getByRole("button", { name: "保存" })).toBeVisible();
  expect(screen.getByRole("dialog", { name: "编辑金额" })).toHaveClass(
    "rounded-t-lg",
  );
  expect(screen.getByRole("dialog", { name: "编辑金额" })).not.toHaveClass(
    "data-[side=bottom]:h-dvh",
  );
});

test("字段未修改时关闭编辑器且不发送更新请求", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  render(
    <ExpenseEditOverlay
      open
      target="TITLE"
      onOpenChange={onOpenChange}
      onSaved={vi.fn()}
      timeZone="Asia/Shanghai"
      context={context}
      data={data}
    />,
  );

  await user.click(await screen.findByRole("button", { name: "保存" }));

  expect(mocks.updateExpense).not.toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("选择当前分类不发送更新请求", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  render(
    <ExpenseEditOverlay
      open
      target="CATEGORY"
      onOpenChange={onOpenChange}
      onSaved={vi.fn()}
      timeZone="Asia/Shanghai"
      context={context}
      data={data}
    />,
  );

  const dialog = await screen.findByRole("dialog", { name: "编辑分类" });
  await user.click(within(dialog).getByRole("radio", { name: "餐饮" }));

  expect(mocks.updateExpense).not.toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("均摊编辑添加临时成员后自动参与，仍需完成才更新账单", async () => {
  const user = userEvent.setup();
  mocks.addGuestMember.mockResolvedValue({
    id: "guest-1",
    displayName: "阿岚",
    status: "ACTIVE",
    avatarPreset: null,
  });
  render(
    <ExpenseEditOverlay
      open
      target="SPLIT"
      onOpenChange={vi.fn()}
      onSaved={vi.fn()}
      timeZone="Asia/Shanghai"
      context={context}
      data={{
        ...data,
        expense: { ...data.expense, splitMode: "EQUAL" },
        shares: data.shares.map((share) => ({
          ...share,
          splitInputMinor: null,
        })),
      }}
    />,
  );

  await user.click(await screen.findByRole("button", { name: "参与成员" }));
  await user.click(screen.getByRole("button", { name: "添加临时成员" }));
  await user.type(screen.getByLabelText("临时成员昵称"), "阿岚");
  await user.click(screen.getByRole("button", { name: "确认添加" }));

  expect(await screen.findByRole("checkbox", { name: "阿岚" })).toBeChecked();
  expect(mocks.updateExpense).not.toHaveBeenCalled();
  await user.click(
    within(screen.getByRole("dialog", { name: "参与成员" })).getByRole(
      "button",
      { name: "完成" },
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "参与成员" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "参与成员" })).toHaveTextContent(
    "3 人",
  );
});
