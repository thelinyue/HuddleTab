// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createExpense: vi.fn() }));

vi.mock("@/features/expenses/api", () => ({
  createExpense: mocks.createExpense,
}));

import {
  QuickExpenseForm,
  type QuickExpenseNavigationView,
} from "@/features/expenses/components/quick-expense-form";

type HarnessProps = Omit<
  ComponentProps<typeof QuickExpenseForm>,
  "step" | "onStepChange" | "onSplitValidityChange" | "timeZone"
> & { readonly timeZone?: string };

function QuickExpenseHarness({
  timeZone = "Asia/Shanghai",
  ...props
}: HarnessProps) {
  const [step, setStep] = useState<"ENTRY" | "SPLIT">("ENTRY");
  const [splitValid, setSplitValid] = useState(false);

  return (
    <>
      {step === "SPLIT" ? (
        <header>
          <button
            type="button"
            aria-label="返回快速记账"
            onClick={() => setStep("ENTRY")}
          >
            返回
          </button>
          <h1>分摊设置</h1>
          <button
            type="button"
            aria-label="完成"
            disabled={!splitValid}
            onClick={() => setStep("ENTRY")}
            className="min-h-11"
          >
            完成
          </button>
        </header>
      ) : null}
      <QuickExpenseForm
        {...props}
        timeZone={timeZone}
        step={step}
        onStepChange={setStep}
        onSplitValidityChange={setSplitValid}
      />
    </>
  );
}

function CurrencyNavigationHarness(props: HarnessProps) {
  const [navigationView, setNavigationView] =
    useState<QuickExpenseNavigationView>("entry");

  return (
    <QuickExpenseForm
      {...props}
      timeZone={props.timeZone ?? "Asia/Shanghai"}
      navigationView={navigationView}
      onNavigationViewChange={setNavigationView}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  mocks.createExpense.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const activity = {
  id: "a1",
  baseCurrency: "CNY",
  currentMemberId: "m1",
  currentUserId: "u1",
};
const members = [
  {
    id: "m1",
    displayName: "小王",
    status: "ACTIVE" as const,
    avatarPreset: 6 as const,
  },
  { id: "m2", displayName: "小李", status: "ACTIVE" as const },
];
const preference = {
  lastCategory: "OTHER" as const,
  recentParticipantIds: ["m1", "m2"],
  recentPayerIds: ["m1"],
  recentCurrency: "CNY",
};

test("当前活动没有历史分类时默认选择餐饮", () => {
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={{ ...preference, lastCategory: null }}
      onSaved={vi.fn()}
    />,
  );

  const category = screen.getByRole("button", { name: "分类" });
  expect(category).toHaveTextContent("餐饮");
  expect(
    category.querySelector('img[data-category-illustration="FOOD"]'),
  ).toBeInTheDocument();
});

test("金额旁币种选择保留表单并按主币种关系重置汇率状态", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  mocks.createExpense.mockResolvedValue({
    expense: { id: "expense-1", title: "拉面" },
  });
  render(
    <CurrencyNavigationHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额", { exact: true }), "1280");
  await user.type(screen.getByLabelText("用途"), "拉面");
  await user.click(screen.getByRole("button", { name: "币种" }));
  await user.type(screen.getByRole("combobox", { name: "搜索币种" }), "JPY");
  await user.click(screen.getByRole("option", { name: /JPY日元/ }));

  expect(screen.getByLabelText("金额", { exact: true })).toHaveValue("1280");
  expect(screen.getByLabelText("用途")).toHaveValue("拉面");
  expect(screen.getByRole("button", { name: "币种" })).toHaveTextContent(
    "JPY",
  );
  await user.click(screen.getByRole("button", { name: "更多设置" }));
  expect(screen.queryByRole("textbox", { name: "币种" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("汇率")).toHaveValue("");
  expect(screen.getByRole("radio", { name: "手动输入" })).toBeChecked();

  await user.click(screen.getByRole("button", { name: "币种" }));
  await user.type(screen.getByRole("combobox", { name: "搜索币种" }), "CNY");
  await user.click(screen.getByRole("option", { name: /CNY人民币/ }));
  expect(screen.getByLabelText("汇率")).toHaveValue("1");
  expect(screen.getByRole("radio", { name: "主币种" })).toBeChecked();
});

test("默认时间和提交瞬间都使用部署 TZ 而不是浏览器时区", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-31T01:53:00.000Z"));
  mocks.createExpense.mockResolvedValue({ expense: { id: "expense-1" } });
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      timeZone="Pacific/Honolulu"
      onSaved={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "更多设置" }));
  expect(screen.getByLabelText("消费时间")).toHaveValue("2026-08-30T15:53");
  expect(screen.getByLabelText("汇率时间")).toHaveValue("2026-08-30T15:53");

  fireEvent.change(screen.getByLabelText("金额"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("用途"), {
    target: { value: "早餐" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));

  await vi.waitFor(() =>
    expect(mocks.createExpense).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({
        exchangeRateAt: "2026-08-31T01:53:00.000Z",
        occurredAt: "2026-08-31T01:53:00.000Z",
      }),
    ),
  );
});

test("快捷录入按金额、用途、付款人、参与成员、分类和更多设置排列", () => {
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  const amount = screen.getByLabelText("金额");
  const title = screen.getByLabelText("用途");
  const payer = screen.getByRole("button", { name: "谁付款" });
  const participants = screen.getByRole("button", { name: "谁参与" });
  const category = screen.getByRole("button", { name: "分类" });
  const advanced = screen.getByRole("button", { name: "更多设置" });
  const save = screen.getByRole("button", { name: "保存" });

  expect(amount.closest("form")).toHaveClass("h-full");
  expect(amount.closest("[data-quick-expense-step]")).toHaveClass("flex-1");
  expect(amount).toHaveAttribute("placeholder", "0.00");
  expect(amount).toHaveClass(
    "font-amount",
    "type-display-amount",
    "min-h-11",
    "font-semibold",
    "focus-visible:outline-ring",
  );
  expect(title.closest("label")).toHaveClass(
    "rounded-md",
    "focus-within:border-ring",
  );
  expect(payer).toHaveTextContent("小王");
  expect(participants).toHaveTextContent("2 人");
  expect(category).toHaveTextContent("其他");
  expect(
    category.querySelector('img[data-category-illustration="OTHER"]'),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "谁付款" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "多人付款" }),
  ).not.toBeInTheDocument();
  for (const avatar of screen.getAllByLabelText("小王的头像")) {
    expect(avatar.querySelector("img")).toHaveAttribute(
      "src",
      "/member-avatars/avatar-06.webp",
    );
  }
  expect(advanced).toHaveClass("rounded-md", "type-body");
  expect(save).toHaveClass(
    "h-12",
    "rounded-md",
    "type-section-title",
    "text-primary-foreground",
  );
  expect(
    amount.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    title.compareDocumentPosition(payer) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    payer.compareDocumentPosition(participants) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    participants.compareDocumentPosition(advanced) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    participants.compareDocumentPosition(category) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    category.compareDocumentPosition(advanced) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    advanced.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("分类通过轻量单选 Sheet 立即更新并将焦点还给入口", async () => {
  const user = userEvent.setup();
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  const category = screen.getByRole("button", { name: "分类" });
  await user.click(category);

  const sheet = screen.getByRole("dialog", { name: "分类" });
  const options = within(sheet).getByRole("radiogroup", { name: "分类" });
  expect(options).toBeVisible();
  for (const label of [
    "餐饮",
    "交通",
    "住宿",
    "门票",
    "购物",
    "娱乐",
    "其他",
  ]) {
    expect(within(options).getByRole("radio", { name: label })).toBeVisible();
  }
  expect(
    options.querySelectorAll("img[data-category-illustration]"),
  ).toHaveLength(7);
  expect(options).toHaveClass("grid-cols-5");
  expect(options.querySelectorAll("img.rounded-full")).toHaveLength(0);
  expect(within(options).getByRole("radio", { name: "其他" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await user.click(within(options).getByRole("radio", { name: "餐饮" }));

  expect(
    screen.queryByRole("dialog", { name: "分类" }),
  ).not.toBeInTheDocument();
  expect(category).toHaveTextContent("餐饮");
  expect(
    category.querySelector('img[data-category-illustration="FOOD"]'),
  ).toBeInTheDocument();
  expect(category).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "更多设置" }));
  expect(
    screen.queryByRole("radiogroup", { name: "分类" }),
  ).not.toBeInTheDocument();
});

test("分类选择会进入创建账单提交契约", async () => {
  const user = userEvent.setup();
  mocks.createExpense.mockResolvedValue({ expense: { id: "expense-1" } });
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "88");
  await user.type(screen.getByLabelText("用途"), "早餐");
  await user.click(screen.getByRole("button", { name: "分类" }));
  await user.click(
    within(screen.getByRole("radiogroup", { name: "分类" })).getByRole(
      "radio",
      { name: "餐饮" },
    ),
  );
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).toHaveBeenCalledWith(
    "a1",
    expect.objectContaining({ category: "FOOD" }),
  );
});

test("分摊设置在同一表单内前进和返回，并保留快速录入值", async () => {
  const user = userEvent.setup();
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  expect(screen.getByLabelText("金额")).toBeVisible();
  expect(screen.getByLabelText("用途")).toBeVisible();
  expect(screen.queryByLabelText("汇率")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("金额"), "88.5");
  await user.type(screen.getByLabelText("用途"), "晚餐");
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  expect(screen.getByRole("radiogroup", { name: "分摊方式" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "均摊" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "返回快速记账" }));
  expect(screen.getByLabelText("金额")).toHaveValue("88.5");
  expect(screen.getByLabelText("用途")).toHaveValue("晚餐");
  await user.click(screen.getByRole("button", { name: "更多设置" }));
  expect(screen.getByLabelText("汇率")).toBeVisible();
  expect(
    screen.queryByRole("radiogroup", { name: "分类" }),
  ).not.toBeInTheDocument();
});

test("参与成员只有在成员面板点击完成后才更新并进入分摊设置", async () => {
  const user = userEvent.setup();
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "谁参与" }));
  await user.click(screen.getByRole("checkbox", { name: "小李" }));
  await user.click(screen.getByRole("button", { name: "完成" }));

  expect(screen.getByRole("button", { name: "谁参与" })).toHaveTextContent(
    "小王",
  );
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  expect(screen.getByRole("heading", { name: "参与成员 · 1人" })).toBeVisible();
});

test("合法分摊点击完成返回快速记账，再由底部保存提交", async () => {
  const user = userEvent.setup();
  mocks.createExpense.mockResolvedValue({ expense: { id: "expense-1" } });
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "88.5");
  await user.type(screen.getByLabelText("用途"), "晚餐");
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  expect(screen.getAllByRole("heading", { name: "分摊设置" })).toHaveLength(1);
  const complete = screen.getByRole("button", { name: "完成" });
  expect(complete).toHaveTextContent("完成");
  expect(complete).toHaveClass("min-h-11");
  expect(complete).toBeEnabled();
  await user.click(complete);
  expect(screen.getByLabelText("金额")).toHaveValue("88.5");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).toHaveBeenCalledWith(
    "a1",
    expect.objectContaining({
      originalAmountMinor: "8850",
      split: { mode: "EQUAL", members: ["m1", "m2"] },
    }),
  );
});

test("多人付款和精确分摊转换为最小金额，并在付款不守恒时阻止保存", async () => {
  const user = userEvent.setup();
  mocks.createExpense.mockResolvedValue({ expense: { id: "expense-1" } });
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "100");
  await user.type(screen.getByLabelText("用途"), "晚餐");
  await user.click(screen.getByRole("button", { name: "谁付款" }));
  await user.click(screen.getByRole("button", { name: "多人付款" }));
  await user.clear(screen.getByLabelText("小王付款金额"));
  await user.type(screen.getByLabelText("小王付款金额"), "60");
  await user.click(screen.getByRole("checkbox", { name: "小李" }));
  await user.type(screen.getByLabelText("小李付款金额"), "30");
  expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
  await user.clear(screen.getByLabelText("小李付款金额"));
  await user.type(screen.getByLabelText("小李付款金额"), "40");
  await user.click(screen.getByRole("button", { name: "完成" }));
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  await user.click(screen.getByRole("radio", { name: "按金额" }));
  await user.type(screen.getByLabelText("小王分摊值"), "50");
  await user.type(screen.getByLabelText("小李分摊值"), "50");
  await user.click(screen.getByRole("button", { name: "完成" }));
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).toHaveBeenCalledWith(
    "a1",
    expect.objectContaining({
      originalAmountMinor: "10000",
      payments: [
        { memberId: "m1", amountMinor: "6000" },
        { memberId: "m2", amountMinor: "4000" },
      ],
      split: {
        mode: "EXACT",
        entries: [
          { memberId: "m1", value: "5000" },
          { memberId: "m2", value: "5000" },
        ],
      },
    }),
  );
});

test("多人付款完成后修改主金额只标记失效，不自动重分配", async () => {
  const user = userEvent.setup();
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "100");
  await user.type(screen.getByLabelText("用途"), "晚餐");
  await user.click(screen.getByRole("button", { name: "谁付款" }));
  await user.click(screen.getByRole("button", { name: "多人付款" }));
  await user.clear(screen.getByLabelText("小王付款金额"));
  await user.type(screen.getByLabelText("小王付款金额"), "60");
  await user.click(screen.getByRole("checkbox", { name: "小李" }));
  await user.type(screen.getByLabelText("小李付款金额"), "40");
  await user.click(screen.getByRole("button", { name: "完成" }));

  await user.clear(screen.getByLabelText("金额"));
  await user.type(screen.getByLabelText("金额"), "120");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "付款合计必须等于消费金额",
  );
  expect(mocks.createExpense).not.toHaveBeenCalled();
});

test.each([
  {
    label: "均摊",
    expected: { mode: "EQUAL", members: ["m1", "m2"] },
    values: [],
  },
  {
    label: "按金额",
    expected: {
      mode: "EXACT",
      entries: [
        { memberId: "m1", value: "5000" },
        { memberId: "m2", value: "5000" },
      ],
    },
    values: ["50", "50"],
  },
  {
    label: "按比例",
    expected: {
      mode: "PERCENTAGE",
      entries: [
        { memberId: "m1", value: "5000" },
        { memberId: "m2", value: "5000" },
      ],
    },
    values: ["50", "50"],
  },
  {
    label: "按份数",
    expected: {
      mode: "WEIGHT",
      entries: [
        { memberId: "m1", value: "100" },
        { memberId: "m2", value: "300" },
      ],
    },
    values: ["1", "3"],
  },
])("$label 分摊保留现有请求形状", async ({ label, expected, values }) => {
  const user = userEvent.setup();
  mocks.createExpense.mockResolvedValue({ expense: { id: "expense-1" } });
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "100");
  await user.type(screen.getByLabelText("用途"), "分摊测试");
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  await user.click(screen.getByRole("radio", { name: label }));
  for (const [index, value] of values.entries()) {
    const member = members[index]!;
    await user.type(
      screen.getByLabelText(`${member.displayName}分摊值`),
      value,
    );
  }
  await user.click(screen.getByRole("button", { name: "完成" }));
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).toHaveBeenCalledWith(
    "a1",
    expect.objectContaining({ split: expected }),
  );
});

test("失败重试复用同一个 clientMutationId，并将单字段校验错误聚焦到字段", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  mocks.createExpense
    .mockRejectedValueOnce(new Error("网络连接失败，请重试。"))
    .mockResolvedValueOnce({ expense: { id: "expense-1" } });
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={onSaved}
    />,
  );

  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(
    screen.queryByRole("alert", { name: "请修正以下问题" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("金额")).toHaveFocus();
  expect(screen.getAllByText("金额不能为空。")).toHaveLength(1);

  await user.type(screen.getByLabelText("金额"), "10");
  await user.type(screen.getByLabelText("用途"), "早餐");
  await user.click(screen.getByRole("button", { name: "保存" }));
  const summary = screen.getByRole("alert", { name: "请修正以下问题" });
  expect(summary).toHaveTextContent("网络连接失败，请重试。");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).toHaveBeenCalledTimes(2);
  expect(mocks.createExpense.mock.calls[0]?.[1].clientMutationId).toBe(
    mocks.createExpense.mock.calls[1]?.[1].clientMutationId,
  );
  expect(onSaved).toHaveBeenCalledOnce();
});

test("用途字段校验错误只显示一处并将焦点移到用途字段", async () => {
  const user = userEvent.setup();
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "10");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(
    screen.queryByRole("alert", { name: "请修正以下问题" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("用途")).toHaveFocus();
  expect(screen.getAllByText("用途不能为空。")).toHaveLength(1);
});

test("分摊方式是四列 44px 触控选项，并为键盘焦点提供可见样式", async () => {
  const user = userEvent.setup();
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  const modes = screen.getByRole("radiogroup", { name: "分摊方式" });
  expect(modes.querySelector(".grid")).toHaveClass("grid-cols-4");
  for (const label of ["均摊", "按金额", "按比例", "按份数"]) {
    const radio = screen.getByRole("radio", { name: label });
    expect(radio.closest("label")).toHaveClass("min-h-11", "rounded-sm");
    expect(radio.nextElementSibling).toHaveClass("peer-focus-visible:ring-3");
  }
  expect(
    screen.getByRole("radio", { name: "均摊" }).nextElementSibling,
  ).toHaveClass("peer-checked:bg-primary/10", "peer-checked:font-semibold");
});

test("100.01 元均摊按稳定 memberId 展示 50.01 和 50.00", async () => {
  const user = userEvent.setup();
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "100.01");
  await user.click(screen.getByRole("button", { name: "分摊设置" }));

  const rows = screen.getByRole("list", { name: "参与成员承担金额" });
  expect(rows).toHaveClass("divide-y");
  expect(rows).not.toHaveClass("rounded-md", "border", "bg-surface");
  expect(screen.getByRole("heading", { name: "参与成员 · 2人" })).toBeVisible();
  expect(screen.queryByText(/金额：/)).not.toBeInTheDocument();
  expect(within(rows).getByText("小王").closest("li")).toHaveTextContent(
    "¥50.01",
  );
  expect(within(rows).getByText("小李").closest("li")).toHaveTextContent(
    "¥50.00",
  );
  expect(within(rows).getByText("¥50.01")).toHaveClass("text-right");
  expect(within(rows).getByText("¥50.01")).toHaveClass(
    "money",
    "text-base",
    "font-semibold",
  );
  expect(within(rows).getByText("¥50.01")).not.toHaveClass(
    "rounded-sm",
    "border",
    "bg-surface-muted",
  );
  const summary = screen.getByLabelText("分摊摘要");
  expect(summary).toHaveClass("mt-2", "border-t");
  expect(summary.parentElement).toHaveClass("grid", "gap-4");
  expect(summary).not.toHaveClass("rounded-md", "bg-surface");
  expect(summary.children).toHaveLength(2);
  expect(summary.firstElementChild).toHaveClass("justify-between");
  expect(within(summary).getByText("人均").parentElement).toHaveClass(
    "justify-between",
  );
  expect(within(summary).getByText("¥50.00")).toHaveClass("font-medium");
  expect(screen.queryByText(/均摊参考/)).not.toBeInTheDocument();
});

test.each([
  { label: "按比例", values: ["25", "75"], expected: ["¥25.00", "¥75.00"] },
  { label: "按份数", values: ["1", "3"], expected: ["¥25.00", "¥75.00"] },
])(
  "$label 合法规则输入与最终承担金额同屏展示",
  async ({ label, values, expected }) => {
    const user = userEvent.setup();
    render(
      <QuickExpenseHarness
        activity={activity}
        members={members}
        preference={preference}
        onSaved={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("金额"), "100");
    await user.click(screen.getByRole("button", { name: "分摊设置" }));
    await user.click(screen.getByRole("radio", { name: label }));
    for (const [index, value] of values.entries()) {
      await user.type(
        screen.getByLabelText(`${members[index]!.displayName}分摊值`),
        value,
      );
    }

    for (const [index, amount] of expected.entries()) {
      const rows = screen.getByRole("list", { name: "参与成员承担金额" });
      expect(
        within(rows).getByText(members[index]!.displayName).closest("li"),
      ).toHaveTextContent(amount);
    }
  },
);

test("按金额只显示两个真实输入，不重复渲染金额结果", async () => {
  const user = userEvent.setup();
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "100");
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  await user.click(screen.getByRole("radio", { name: "按金额" }));
  await user.type(screen.getByLabelText("小王分摊值"), "25");
  await user.type(screen.getByLabelText("小李分摊值"), "75");
  const rows = screen.getByRole("list", { name: "参与成员承担金额" });
  expect(within(rows).getAllByRole("textbox")).toHaveLength(2);
  expect(screen.getByLabelText("小王分摊值")).toHaveValue("25");
  expect(screen.getByLabelText("小李分摊值")).toHaveValue("75");
  expect(within(rows).queryByText(/¥/)).not.toBeInTheDocument();
});

test.each([
  {
    label: "按金额",
    values: ["25", "75"],
    summaryLabel: "已分配",
    summaryValue: "¥100.00 / ¥100.00",
    summaryRows: 1,
  },
  {
    label: "按比例",
    values: ["25", "75"],
    summaryLabel: "已分配",
    summaryValue: "100.00%",
    summaryRows: 2,
  },
  {
    label: "按份数",
    values: ["1", "3"],
    summaryLabel: "总份数",
    summaryValue: "4.00",
    summaryRows: 2,
  },
])(
  "$label 使用模式对应的两行摘要",
  async ({ label, values, summaryLabel, summaryValue, summaryRows }) => {
    const user = userEvent.setup();
    render(
      <QuickExpenseHarness
        activity={activity}
        members={members}
        preference={preference}
        onSaved={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("金额"), "100");
    await user.click(screen.getByRole("button", { name: "分摊设置" }));
    await user.click(screen.getByRole("radio", { name: label }));
    for (const [index, value] of values.entries()) {
      await user.type(
        screen.getByLabelText(`${members[index]!.displayName}分摊值`),
        value,
      );
    }

    const summary = screen.getByLabelText("分摊摘要");
    expect(summary.firstElementChild).toHaveTextContent(summaryLabel);
    expect(summary.firstElementChild).toHaveTextContent(summaryValue);
    expect(summary.children).toHaveLength(summaryRows);
    if (summaryRows === 2) {
      expect(within(summary).getByText("合计")).toBeVisible();
    }
  },
);

test.each([
  { label: "按比例", suffix: "%", values: ["25", "75"] },
  { label: "按份数", suffix: "份", values: ["1", "3"] },
])(
  "$label 同行显示输入后缀和纯文本金额结果",
  async ({ label, suffix, values }) => {
    const user = userEvent.setup();
    render(
      <QuickExpenseHarness
        activity={activity}
        members={members}
        preference={preference}
        onSaved={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("金额"), "100");
    await user.click(screen.getByRole("button", { name: "分摊设置" }));
    await user.click(screen.getByRole("radio", { name: label }));
    for (const [index, value] of values.entries()) {
      await user.type(
        screen.getByLabelText(`${members[index]!.displayName}分摊值`),
        value,
      );
    }

    const rows = screen.getByRole("list", { name: "参与成员承担金额" });
    expect(within(rows).getAllByText(suffix)).toHaveLength(2);
    const result = within(rows).getByText("¥25.00");
    expect(result.tagName).toBe("SPAN");
    expect(result).toHaveClass("text-right");
    expect(result).not.toHaveClass("rounded-sm", "border", "bg-surface-muted");
  },
);

test("未完成的比例规则将最终承担金额显示为待完成", async () => {
  const user = userEvent.setup();
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "100");
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  await user.click(screen.getByRole("radio", { name: "按比例" }));
  await user.type(screen.getByLabelText("小王分摊值"), "25");

  expect(screen.getAllByText("待完成")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
  await user.type(screen.getByLabelText("小李分摊值"), "75");
  expect(screen.getByRole("button", { name: "完成" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "完成" }));
  expect(screen.getByLabelText("金额")).toBeVisible();
});

test("编辑模式保留账单输入，并通过在线更新提交器保存完整账务请求", async () => {
  const user = userEvent.setup();
  const submitExpense = vi.fn().mockResolvedValue({
    id: "expense-1",
    title: "海底捞火锅",
    baseAmountMinor: "42800",
    baseCurrency: "CNY",
  });
  const onSaved = vi.fn();
  render(
    <QuickExpenseHarness
      activity={activity}
      members={members}
      preference={preference}
      online
      initialValues={{
        amount: "428.00",
        title: "海底捞火锅",
        category: "FOOD",
        currency: "CNY",
        exchangeRate: "1",
        exchangeRateSource: "IDENTITY",
        exchangeRateAt: "2026-08-27T16:00",
        occurredAt: "2026-08-27T16:00",
        note: "朋友聚餐",
        splitMode: "PERCENTAGE",
        payerSelection: { mode: "single", memberId: "m1" },
        participantIds: ["m1", "m2"],
        splitEntries: { m1: "25.00", m2: "75.00" },
      }}
      submitExpense={submitExpense}
      submitLabel="保存修改"
      allowAttachments={false}
      onSaved={onSaved}
    />,
  );

  expect(screen.getByLabelText("金额")).toHaveValue("428.00");
  expect(screen.getByLabelText("用途")).toHaveValue("海底捞火锅");
  await user.click(screen.getByRole("button", { name: "更多设置" }));
  expect(screen.getByLabelText("备注")).toHaveValue("朋友聚餐");
  expect(screen.queryByLabelText("附件（最多三张）")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "保存修改" }));

  expect(submitExpense).toHaveBeenCalledWith(
    expect.objectContaining({
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
    }),
  );
  expect(onSaved).toHaveBeenCalledWith(
    expect.objectContaining({ id: "expense-1", title: "海底捞火锅" }),
  );
  expect(mocks.createExpense).not.toHaveBeenCalled();
});
