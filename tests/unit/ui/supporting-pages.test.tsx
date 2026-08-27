// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { MemberList } from "@/features/members/components/member-list";
import { ThemeSelector } from "@/features/me/components/theme-selector";

test("成员列表按状态分组，并显示角色、账务身份和头像", () => {
  render(
    <MemberList
      members={[
        {
          id: "m0",
          displayName: "小李",
          role: "OWNER",
          status: "ACTIVE",
          memberType: "USER",
          permissions: { canManage: false },
        },
        {
          id: "m1",
          displayName: "小王",
          role: "MEMBER",
          status: "LEFT",
          memberType: "USER",
          permissions: { canManage: false },
        },
      ]}
    />,
  );
  expect(screen.getByRole("heading", { name: "活动中" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "已退出" })).toBeVisible();
  expect(screen.getAllByText("正式账号")).toHaveLength(2);
  expect(screen.getByRole("img", { name: "小王的头像" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "添加临时成员" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /移除/ }),
  ).not.toBeInTheDocument();
});

test("活动管理者可以从成员页添加临时成员和移除普通成员", () => {
  render(
    <MemberList
      members={[
        {
          id: "m1",
          displayName: "Owner",
          role: "OWNER",
          status: "ACTIVE",
          memberType: "USER",
          permissions: { canManage: true },
        },
        {
          id: "m2",
          displayName: "小王",
          role: "MEMBER",
          status: "ACTIVE",
          memberType: "GUEST",
          permissions: { canManage: true },
        },
      ]}
      onAddGuest={vi.fn()}
      onRemove={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "添加临时成员" })).toBeVisible();
  expect(screen.getByRole("button", { name: "移除 小王" })).toBeVisible();
});

test("主题有三个可键盘操作的选项", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<ThemeSelector value="SYSTEM" onChange={onChange} />);
  expect(screen.getByRole("radiogroup", { name: "主题" })).toBeVisible();
  await user.click(screen.getByRole("radio", { name: "暗色" }));
  expect(onChange).toHaveBeenCalledWith("DARK");
});
