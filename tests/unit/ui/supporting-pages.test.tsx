// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { MemberList } from "@/features/members/components/member-list";
import { ThemeSelector } from "@/features/me/components/theme-selector";

test("成员列表同时显示角色、账务身份和 LEFT 文本状态", () => {
  render(
    <MemberList
      members={[
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
  expect(screen.getByText("成员")).toBeVisible();
  expect(screen.getByText("已退出")).toBeVisible();
  expect(screen.getByText("正式账号")).toBeVisible();
});

test("主题有三个可键盘操作的选项", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<ThemeSelector value="SYSTEM" onChange={onChange} />);
  expect(screen.getByRole("radiogroup", { name: "主题" })).toBeVisible();
  await user.click(screen.getByRole("radio", { name: "暗色" }));
  expect(onChange).toHaveBeenCalledWith("DARK");
});
