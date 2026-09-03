import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutation = vi.hoisted(() => ({
  isPending: false,
  mutateAsync: vi.fn(),
}));

vi.mock("../auth/api", () => ({
  useChangePasswordMutation: () => mutation,
  useSessionQuery: () => ({ data: { userId: "user-1" }, isPending: false }),
}));

vi.mock("../notifications/api", () => ({
  useNotificationsQuery: () => ({ data: { items: [], timeZone: "Asia/Shanghai", unreadCount: 0 } }),
}));

import { ChangePasswordPage } from "./password-page";

function renderPage() {
  return render(<MemoryRouter initialEntries={["/me/password"]}><ChangePasswordPage /></MemoryRouter>);
}

function fillPasswords(values = {
  currentPassword: "old-password",
  newPassword: "new-password",
  confirmedPassword: "new-password",
}) {
  fireEvent.change(screen.getByLabelText("当前密码"), {
    target: { value: values.currentPassword },
  });
  fireEvent.change(screen.getByLabelText("新密码"), {
    target: { value: values.newPassword },
  });
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: values.confirmedPassword },
  });
}

function submitForm() {
  const form = screen.getByRole("button", { name: "确认修改" }).closest("form");
  if (!form) throw new Error("修改密码按钮应位于表单内");
  fireEvent.submit(form);
}

afterEach(() => {
  cleanup();
  mutation.isPending = false;
  mutation.mutateAsync.mockReset();
});

describe("ChangePasswordPage", () => {
  it("确认密码不一致时在客户端拒绝提交", () => {
    renderPage();
    fillPasswords({
      currentPassword: "old-password",
      newPassword: "new-password",
      confirmedPassword: "other-password",
    });

    submitForm();

    expect(screen.getByRole("alert")).toHaveTextContent("新密码与确认密码不一致。");
    expect(screen.getByLabelText("确认新密码")).toHaveAttribute("aria-invalid", "true");
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("修改成功后清空敏感字段并保持在已登录页面", async () => {
    mutation.mutateAsync.mockResolvedValue({ changed: true });
    renderPage();
    fillPasswords();

    submitForm();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("密码已修改。");
    });
    expect(mutation.mutateAsync).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "new-password",
    });
    expect(screen.getByLabelText("当前密码")).toHaveValue("");
    expect(screen.getByLabelText("新密码")).toHaveValue("");
    expect(screen.getByLabelText("确认新密码")).toHaveValue("");
    expect(screen.getByRole("heading", { name: "修改密码" })).toBeInTheDocument();
  });

  it("服务端拒绝时保留输入并显示中文错误", async () => {
    mutation.mutateAsync.mockRejectedValue(new Error("当前密码错误"));
    renderPage();
    fillPasswords();

    submitForm();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("当前密码错误");
    });
    expect(screen.getByLabelText("当前密码")).toHaveValue("old-password");
    expect(screen.getByLabelText("新密码")).toHaveValue("new-password");
  });

  it("请求未完成时禁用按钮并阻止重复提交", async () => {
    let resolveRequest: ((value: { changed: boolean }) => void) | undefined;
    mutation.mutateAsync.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    renderPage();
    fillPasswords();

    submitForm();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "修改中…" })).toBeDisabled();
    });
    const form = screen.getByRole("button", { name: "修改中…" }).closest("form");
    if (!form) throw new Error("修改中按钮应位于表单内");
    fireEvent.submit(form);

    expect(mutation.mutateAsync).toHaveBeenCalledOnce();
    await act(async () => {
      resolveRequest?.({ changed: true });
    });
  });

  it("提供返回我的入口并保留产品主导航", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "返回我的" })).toHaveAttribute("href", "/me");
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "我的" })).toHaveClass("active");
  });
});
