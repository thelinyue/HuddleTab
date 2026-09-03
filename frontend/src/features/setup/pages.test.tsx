import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupPage } from "./pages";

const setupState = vi.hoisted(() => ({
  data: { setupRequired: true } as { setupRequired: boolean } | undefined,
  error: null as unknown,
  isPending: false,
  refetch: vi.fn(),
}));

vi.mock("./api", () => ({ useSetupStatusQuery: () => setupState }));

describe("SetupPage", () => {
  afterEach(() => {
    cleanup();
    setupState.data = { setupRequired: true };
    setupState.error = null;
    setupState.isPending = false;
    setupState.refetch.mockReset();
  });

  it("只提供 CLI 初始化指引，不渲染凭据输入框", () => {
    render(<SetupPage />);
    expect(screen.getByRole("heading", { name: "初始化管理员" })).toBeVisible();
    expect(screen.getByText(/docker compose exec app huddletab bootstrap-user/)).toBeVisible();
    expect(screen.queryByLabelText("用户名")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
  });

  it("复制命令后保留明确的成功状态", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<SetupPage />);
    fireEvent.click(screen.getByRole("button", { name: "复制命令" }));
    expect(await screen.findByRole("status")).toHaveTextContent("命令已复制");
  });

  it("状态读取失败时阻止进入产品并提供重试", () => {
    setupState.data = undefined;
    setupState.error = new Error("database unavailable");
    render(<SetupPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("无法确认初始化状态");
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(setupState.refetch).toHaveBeenCalledOnce();
  });
});
