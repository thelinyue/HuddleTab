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

import { MemberList } from "@/features/members/components/member-list";
import { ThemeSelector } from "@/features/me/components/theme-selector";

afterEach(cleanup);

const members = [
  {
    id: "preview-member-0",
    displayName: "我",
    role: "OWNER" as const,
    status: "ACTIVE" as const,
    memberType: "USER" as const,
    permissions: { canManage: true },
  },
  {
    id: "preview-member-1",
    displayName: "小王",
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
    memberType: "USER" as const,
    permissions: { canManage: true },
  },
  {
    id: "preview-member-2",
    displayName: "小李",
    role: "MEMBER" as const,
    status: "ACTIVE" as const,
    memberType: "USER" as const,
    permissions: { canManage: true },
  },
  {
    id: "preview-member-3",
    displayName: "小陈",
    role: "MEMBER" as const,
    status: "ACTIVE" as const,
    memberType: "GUEST" as const,
    permissions: { canManage: true },
  },
] as const;

test("成员列表使用轻量行、中文标签、单行余额和统一查看入口", () => {
  render(
    <MemberList
      members={members}
      inviteMode="DIRECT_JOIN"
      currency="CNY"
      balances={[
        { memberId: "preview-member-0", netMinor: "32650" },
        { memberId: "preview-member-1", netMinor: "-18650" },
        { memberId: "preview-member-2", netMinor: "-14000" },
        { memberId: "preview-member-3", netMinor: "0" },
      ]}
    />,
  );

  expect(screen.getByRole("heading", { name: "活动成员 · 4人" })).toBeVisible();
  const activeList = screen.getByRole("list", { name: "活动成员 · 4人" });
  expect(activeList).not.toHaveClass("rounded-sm");
  expect(activeList).not.toHaveClass("border");
  expect(screen.getByText("所有者")).toBeVisible();
  expect(screen.getByText("活跃")).toBeVisible();
  expect(screen.getByText("管理员")).toBeVisible();
  expect(screen.getByText("访客")).toBeVisible();
  expect(screen.queryByText("成员")).not.toBeInTheDocument();
  expect(screen.getByText("创建者")).toBeVisible();
  expect(screen.getAllByText("正式成员")).toHaveLength(2);
  expect(screen.getByText("临时成员")).toBeVisible();

  const ownerRow = screen.getByRole("button", { name: "查看成员 我" });
  expect(ownerRow).toHaveTextContent("应收 ¥326.50");
  expect(ownerRow.querySelector('[data-money-tone="receivable"]')).toHaveClass(
    "tabular-nums",
  );
  expect(
    screen.getByRole("button", { name: "查看成员 小王" }),
  ).toHaveTextContent("应付 ¥186.50");
  expect(
    screen.getByRole("button", { name: "查看成员 小陈" }),
  ).toHaveTextContent("已结清");
  expect(screen.getAllByTestId("member-row-chevron")).toHaveLength(4);
  expect(
    screen.queryByRole("button", { name: /移除/ }),
  ).not.toBeInTheDocument();
});

test("点击成员行打开管理 Sheet，只有管理者可对活跃非所有者发起移除", async () => {
  const user = userEvent.setup();
  render(
    <MemberList
      members={members}
      inviteMode="DIRECT_JOIN"
      onRemove={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  await user.click(screen.getByRole("button", { name: "查看成员 我" }));
  expect(screen.getByRole("dialog", { name: "成员管理" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "移除成员" }),
  ).not.toBeInTheDocument();
  await user.keyboard("{Escape}");

  await user.click(screen.getByRole("button", { name: "查看成员 小王" }));
  expect(screen.getByRole("button", { name: "移除成员" })).toBeVisible();
});

test("普通成员和已离开成员只能查看成员信息", async () => {
  const user = userEvent.setup();
  render(
    <MemberList
      members={[
        {
          id: "regular",
          displayName: "普通成员",
          role: "MEMBER",
          status: "ACTIVE",
          memberType: "USER",
          permissions: { canManage: false },
        },
        {
          id: "left",
          displayName: "离开成员",
          role: "MEMBER",
          status: "LEFT",
          memberType: "USER",
          permissions: { canManage: true },
        },
      ]}
      inviteMode="DIRECT_JOIN"
      onRemove={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  await user.click(screen.getByRole("button", { name: "查看成员 普通成员" }));
  expect(
    screen.queryByRole("button", { name: "移除成员" }),
  ).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "查看成员 离开成员" }));
  expect(
    screen.queryByRole("button", { name: "移除成员" }),
  ).not.toBeInTheDocument();
});

test("移除成员需要二次确认，提交中禁用操作，成功后关闭成员 Sheet", async () => {
  const user = userEvent.setup();
  let resolveRemove: (() => void) | undefined;
  const onRemove = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveRemove = resolve;
      }),
  );
  render(
    <MemberList
      members={members}
      inviteMode="DIRECT_JOIN"
      onRemove={onRemove}
    />,
  );

  await user.click(screen.getByRole("button", { name: "查看成员 小王" }));
  await user.click(screen.getByRole("button", { name: "移除成员" }));
  expect(
    screen.getByRole("alertdialog", { name: "确认移除成员" }),
  ).toBeVisible();
  expect(screen.getByText(/账务记录/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "确认移除" }));
  expect(onRemove).toHaveBeenCalledWith("preview-member-1");
  expect(screen.getByRole("button", { name: "移除中…" })).toBeDisabled();

  resolveRemove?.();
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "成员管理" }),
    ).not.toBeInTheDocument(),
  );
});

test("移除失败时保留成员 Sheet 并显示中文错误", async () => {
  const user = userEvent.setup();
  render(
    <MemberList
      members={members}
      inviteMode="DIRECT_JOIN"
      onRemove={vi.fn().mockRejectedValue(new Error("当前成员仍有关联账务。"))}
    />,
  );

  await user.click(screen.getByRole("button", { name: "查看成员 小王" }));
  await user.click(screen.getByRole("button", { name: "移除成员" }));
  await user.click(screen.getByRole("button", { name: "确认移除" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "当前成员仍有关联账务。",
  );
  expect(screen.getByRole("dialog", { name: "成员管理" })).toBeVisible();
});

test("添加临时成员使用响应式 Overlay，成功后关闭并清空表单", async () => {
  const user = userEvent.setup();
  const onAddGuest = vi.fn().mockResolvedValue(undefined);
  render(
    <MemberList
      members={members}
      inviteMode="DIRECT_JOIN"
      onAddGuest={onAddGuest}
      onCreateInvite={vi.fn().mockResolvedValue("/join/token")}
      onDisableInvite={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  const actions = screen.getByRole("group", { name: "成员操作" });
  const buttons = within(actions).getAllByRole("button");
  expect(buttons).toHaveLength(2);
  for (const button of buttons)
    expect(button).toHaveClass("h-12", "rounded-xl");

  await user.click(screen.getByRole("button", { name: "添加临时成员" }));
  expect(screen.getByRole("dialog", { name: "添加临时成员" })).toBeVisible();
  await user.type(
    screen.getByRole("textbox", { name: "临时成员昵称" }),
    "小周",
  );
  await user.click(screen.getByRole("button", { name: "确认添加" }));
  expect(onAddGuest).toHaveBeenCalledWith("小周");
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "添加临时成员" }),
    ).not.toBeInTheDocument(),
  );
});

test("顶部邀请按钮与链接加入行复用邀请 Overlay，并按模式显示说明", async () => {
  const user = userEvent.setup();
  const onCreateInvite = vi.fn().mockResolvedValue("/join/invite-token-value");
  render(
    <MemberList
      members={members}
      inviteMode="REQUIRE_APPROVAL"
      onAddGuest={vi.fn().mockResolvedValue(undefined)}
      onCreateInvite={onCreateInvite}
      onDisableInvite={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  expect(screen.getByRole("heading", { name: "邀请方式" })).toBeVisible();
  expect(screen.getByText("需管理员审批")).toBeVisible();
  expect(screen.queryByText("邀请码")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "新增" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "邀请成员" }));
  expect(await screen.findByRole("dialog", { name: "邀请成员" })).toBeVisible();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "链接加入" }));
  expect(await screen.findByRole("dialog", { name: "邀请成员" })).toBeVisible();
  expect(onCreateInvite).toHaveBeenCalledTimes(1);
});

test("无离开成员时不渲染已离开分组", () => {
  render(<MemberList members={members} inviteMode="DIRECT_JOIN" />);

  expect(
    screen.queryByRole("heading", { name: /已离开/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("没有已离开成员")).not.toBeInTheDocument();
});

test("长成员名会截断，列表由页面框架负责导航留白", () => {
  const longName = "一二三四五六七八九十".repeat(12);
  render(
    <MemberList
      members={[
        {
          id: "long-name",
          displayName: longName,
          role: "MEMBER",
          status: "ACTIVE",
          memberType: "USER",
          permissions: { canManage: false },
        },
      ]}
      inviteMode="DIRECT_JOIN"
    />,
  );

  expect(screen.getByText(longName)).toHaveClass("truncate");
  expect(screen.getByRole("region", { name: "成员" })).not.toHaveClass("pb-24");
});

test("主题有三个可键盘操作的选项", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<ThemeSelector value="SYSTEM" onChange={onChange} />);
  expect(screen.getByRole("radiogroup", { name: "主题" })).toBeVisible();
  await user.click(screen.getByRole("radio", { name: "暗色" }));
  expect(onChange).toHaveBeenCalledWith("DARK");
});
