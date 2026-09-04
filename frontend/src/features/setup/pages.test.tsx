import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/error";
import { SetupPage } from "./pages";

const mocks = vi.hoisted(() => ({
  setup: { isPending: false, mutateAsync: vi.fn() },
  login: { isPending: false, mutateAsync: vi.fn() },
  status: { isPending: false, error: null as unknown, data: { setupRequired: true }, refetch: vi.fn() },
}));

vi.mock("./api", () => ({
  useInitializeSetupMutation: () => mocks.setup,
  useSetupStatusQuery: () => mocks.status,
}));

vi.mock("../auth/api", () => ({
  useLoginMutation: () => mocks.login,
}));

describe("SetupPage", () => {
  afterEach(() => cleanup());

  function input(name: string) {
    const element = document.querySelector(`input[name="${name}"]`);
    if (!(element instanceof HTMLInputElement)) throw new Error(`缺少初始化字段 ${name}`);
    return element;
  }

  beforeEach(() => {
    mocks.setup.isPending = false;
    mocks.setup.mutateAsync.mockReset().mockResolvedValue({ initialized: true });
    mocks.login.isPending = false;
    mocks.login.mutateAsync.mockReset().mockResolvedValue({});
    mocks.status.isPending = false;
    mocks.status.error = null;
    mocks.status.data = { setupRequired: true };
    mocks.status.refetch.mockReset();
  });

  it("按 v0.0.2 顺序显示管理员昵称、用户名和两次密码", () => {
    render(<SetupPage />);
    expect(screen.getAllByRole("textbox").map((element) => element.getAttribute("name"))).toEqual([
      "displayName",
      "username",
    ]);
    expect(input("displayName")).toBeVisible();
    expect(input("username")).toBeVisible();
    expect(input("password")).toBeVisible();
    expect(input("confirmPassword")).toBeVisible();
    expect(screen.getByRole("button", { name: "完成初始化" })).toBeVisible();
  });

  it("密码不一致时不提交并保留草稿", async () => {
    render(<SetupPage />);
    fireEvent.change(input("displayName"), { target: { value: "管理员" } });
    fireEvent.change(input("username"), { target: { value: "admin" } });
    fireEvent.change(input("password"), { target: { value: "password123" } });
    fireEvent.change(input("confirmPassword"), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: "完成初始化" }));
    expect(await screen.findByText("两次输入的密码不一致。")).toBeVisible();
    expect(mocks.setup.mutateAsync).not.toHaveBeenCalled();
    expect(input("username")).toHaveValue("admin");
  });

  it("初始化成功后使用当前凭据自动登录", async () => {
    render(<SetupPage />);
    fireEvent.change(input("displayName"), { target: { value: "管理员" } });
    fireEvent.change(input("username"), { target: { value: "admin" } });
    fireEvent.change(input("password"), { target: { value: "password123" } });
    fireEvent.change(input("confirmPassword"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "完成初始化" }));
    await waitFor(() => expect(mocks.setup.mutateAsync).toHaveBeenCalledWith({ displayName: "管理员", username: "admin", password: "password123" }));
    await waitFor(() => expect(mocks.login.mutateAsync).toHaveBeenCalledWith({ username: "admin", password: "password123" }));
  });

  it("服务端初始化失败时保留全部表单草稿", async () => {
    mocks.setup.mutateAsync.mockRejectedValueOnce(new Error("初始化暂时失败。"));
    render(<SetupPage />);
    fireEvent.change(input("displayName"), { target: { value: "管理员" } });
    fireEvent.change(input("username"), { target: { value: "admin" } });
    fireEvent.change(input("password"), { target: { value: "password123" } });
    fireEvent.change(input("confirmPassword"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "完成初始化" }));
    expect(await screen.findByText("初始化暂时失败。")).toBeVisible();
    expect(input("displayName")).toHaveValue("管理员");
    expect(input("username")).toHaveValue("admin");
    expect(input("password")).toHaveValue("password123");
    expect(input("confirmPassword")).toHaveValue("password123");
    expect(mocks.login.mutateAsync).not.toHaveBeenCalled();
  });

  it("收到 SETUP_COMPLETED 时仍使用当前凭据尝试登录", async () => {
    mocks.setup.mutateAsync.mockRejectedValueOnce(
      new ApiRequestError(409, { error: { code: "SETUP_COMPLETED", message: "系统已完成初始化" } } as never),
    );
    render(<SetupPage />);
    fireEvent.change(input("displayName"), { target: { value: "管理员" } });
    fireEvent.change(input("username"), { target: { value: "admin" } });
    fireEvent.change(input("password"), { target: { value: "password123" } });
    fireEvent.change(input("confirmPassword"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "完成初始化" }));
    await waitFor(() => expect(mocks.login.mutateAsync).toHaveBeenCalledWith({ username: "admin", password: "password123" }));
  });
});
