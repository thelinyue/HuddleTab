import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeUsernamePage } from "./username-page";

const state = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("../auth/api", () => ({
  useSessionQuery: () => ({ data: { username: "alice" } }),
  useChangeUsernameMutation: () => state,
}));
afterEach(cleanup);
beforeEach(() => { state.mutateAsync.mockReset(); state.isPending = false; });
const open = () => render(<MemoryRouter><ChangeUsernamePage /></MemoryRouter>);

describe("修改用户名", () => {
  it("预填用户名并阻止无变化及非法输入", () => {
    open();
    const input = screen.getByLabelText("新用户名");
    expect(input).toHaveValue("alice");
    expect(screen.getByRole("button", { name: "保存用户名" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "a!" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("用户名无效");
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });

  it("失败保留草稿，重试成功清空密码并显示服务端规范化后的用户名", async () => {
    state.mutateAsync.mockRejectedValueOnce(new Error("当前密码错误，请重新输入。"))
      .mockResolvedValueOnce({ username: "bob" });
    open();
    fireEvent.change(screen.getByLabelText("新用户名"), { target: { value: " Bob " } });
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "保存用户名" }));
    await screen.findByText("当前密码错误，请重新输入。");
    expect(screen.getByLabelText("新用户名")).toHaveValue(" Bob ");
    expect(screen.getByLabelText("当前密码")).toHaveValue("wrong-password");
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "保存用户名" }));
    await waitFor(() => expect(screen.getByLabelText("当前密码")).toHaveValue(""));
    expect(screen.getByLabelText("新用户名")).toHaveValue("bob");
    expect(screen.getByRole("status")).toHaveTextContent("用户名已修改");
    expect(state.mutateAsync).toHaveBeenLastCalledWith({ newUsername: " Bob ", currentPassword: "correct-password" });
  });
});
