import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../components/theme-provider";

// 账户页面测试独立维护认证 mock，避免依赖活动工作区夹具。
const meApiState = vi.hoisted(() => ({
  avatar: { error: null as unknown, isPending: false, mutateAsync: vi.fn(), reset: vi.fn() },
  displayName: { error: null as unknown, isPending: false, mutateAsync: vi.fn(), reset: vi.fn() },
  logout: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
}));

vi.mock("../auth/api", () => ({
  useLogoutMutation: () => meApiState.logout,
  useUpdateAvatarPresetMutation: () => meApiState.avatar,
  useUpdateDisplayNameMutation: () => meApiState.displayName,
  useSessionQuery: () => ({
    data: { avatarPreset: 4, displayName: "测试用户", isSystemAdmin: true, userId: "user-1", username: "tester" },
    isPending: false,
  }),
}));

import { MePage } from "./page";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => {
  cleanup();
  localStorage.removeItem("huddletab-theme");
  document.documentElement.classList.remove("light", "dark", "theme-transition");
  meApiState.avatar.error = null;
  meApiState.avatar.isPending = false;
  meApiState.avatar.mutateAsync.mockReset().mockResolvedValue(6);
  meApiState.avatar.reset.mockReset();
  meApiState.displayName.error = null;
  meApiState.displayName.isPending = false;
  meApiState.displayName.mutateAsync.mockReset().mockResolvedValue("新昵称");
  meApiState.displayName.reset.mockReset();
  meApiState.logout.error = null;
  meApiState.logout.isPending = false;
  meApiState.logout.mutateAsync.mockReset().mockResolvedValue(undefined);
  vi.unstubAllGlobals();
});

function renderMePage(entry = "/me") {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/me" element={<MePage />} />
          <Route path="/login" element={<p>登录页</p>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("MePage", () => {
  it("从账户与安全区域进入修改密码页", () => {
    renderMePage();

    expect(screen.getByRole("heading", { name: "账户与安全" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "修改密码" })).toHaveAttribute("href", "/me/password");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });

  it("展示已保存头像并允许从六个内置插画中重新选择", async () => {
    renderMePage();

    const avatarButton = screen.getByRole("button", { name: "选择头像" });
    expect(avatarButton.querySelector("img")).toHaveAttribute("src", "/member-avatars/avatar-04.webp");
    fireEvent.click(avatarButton);
    const picker = screen.getByRole("dialog", { name: "选择头像" });
    expect(within(picker).getAllByRole("button", { name: /^头像 / })).toHaveLength(6);
    fireEvent.click(within(picker).getByRole("button", { name: "头像 6" }));
    fireEvent.click(within(picker).getByRole("button", { name: "保存头像" }));

    await waitFor(() => expect(meApiState.avatar.mutateAsync).toHaveBeenCalledWith(6));
    expect(screen.queryByRole("dialog", { name: "选择头像" })).not.toBeInTheDocument();
  });

  it("显示原始用户名、不添加 @，并从昵称入口打开自动聚焦的 Sheet", () => {
    renderMePage();

    expect(screen.getByText("tester")).toBeInTheDocument();
    expect(screen.queryByText("@tester")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "修改昵称" }));

    expect(screen.getByRole("dialog", { name: "修改昵称" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "昵称" })).toHaveFocus();
  });

  it("昵称保存会 trim、支持回车提交并关闭 Sheet", async () => {
    renderMePage();
    fireEvent.click(screen.getByRole("button", { name: "修改昵称" }));
    const input = screen.getByRole("textbox", { name: "昵称" });
    fireEvent.change(input, { target: { value: "  新昵称  " } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(meApiState.displayName.mutateAsync).toHaveBeenCalledWith("新昵称"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "修改昵称" })).not.toBeInTheDocument());
  });

  it("昵称保存失败时保留输入并显示中文错误", async () => {
    meApiState.displayName.error = new Error("昵称保存失败");
    meApiState.displayName.mutateAsync.mockRejectedValue(new Error("昵称保存失败"));
    renderMePage();
    fireEvent.click(screen.getByRole("button", { name: "修改昵称" }));
    const input = screen.getByRole("textbox", { name: "昵称" });
    fireEvent.change(input, { target: { value: "保留输入" } });
    fireEvent.submit(input.closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("昵称保存失败");
    expect(input).toHaveValue("保留输入");
    expect(screen.getByRole("dialog", { name: "修改昵称" })).toBeInTheDocument();
  });

  it("昵称为空或超出 80 个 Unicode 字符时不发起请求", async () => {
    renderMePage();
    fireEvent.click(screen.getByRole("button", { name: "修改昵称" }));
    const input = screen.getByRole("textbox", { name: "昵称" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("昵称无效，请输入 1 到 80 个字符。")).toBeInTheDocument();
    expect(meApiState.displayName.mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "界".repeat(81) } });
    fireEvent.submit(input.closest("form")!);
    expect(meApiState.displayName.mutateAsync).not.toHaveBeenCalled();
  });

  it("允许由代理对组成的 80 个 Unicode 字符昵称", async () => {
    renderMePage();
    fireEvent.click(screen.getByRole("button", { name: "修改昵称" }));
    const nickname = "\u{1F642}".repeat(80);
    const input = screen.getByRole("textbox", { name: "昵称" });
    fireEvent.change(input, { target: { value: nickname } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(meApiState.displayName.mutateAsync).toHaveBeenCalledWith(nickname));
  });

  it("主题 Sheet 提供三态并立即持久化暗色选择", () => {
    renderMePage();
    fireEvent.click(screen.getByRole("button", { name: "主题：跟随系统" }));
    const sheet = screen.getByRole("dialog", { name: "主题" });
    expect(within(sheet).getAllByRole("radio")).toHaveLength(3);
    fireEvent.click(within(sheet).getByRole("radio", { name: "暗色" }));

    expect(within(sheet).getByRole("radio", { name: "暗色" })).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem("huddletab-theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("退出登录成功后替换到登录页", async () => {
    renderMePage();
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => expect(meApiState.logout.mutateAsync).toHaveBeenCalledOnce());
    expect(await screen.findByText("登录页")).toBeInTheDocument();
  });

  it("退出登录失败时保留当前页面并显示就地错误", async () => {
    meApiState.logout.error = new Error("退出登录失败");
    meApiState.logout.mutateAsync.mockRejectedValue(new Error("退出登录失败"));
    renderMePage();
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("退出登录失败");
    expect(screen.getByRole("heading", { name: "我的" })).toBeInTheDocument();
    expect(screen.queryByText("登录页")).not.toBeInTheDocument();
  });
});
