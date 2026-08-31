import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/api", () => ({
  useLogoutMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSessionQuery: () => ({
    data: { displayName: "测试用户", userId: "user-1", username: "tester" },
    isPending: false,
  }),
}));

import { MePage } from "./pages";

afterEach(cleanup);

describe("MePage", () => {
  it("从账户与安全区域进入修改密码页", () => {
    render(<MemoryRouter initialEntries={["/me"]}><MePage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "账户与安全" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "修改密码" })).toHaveAttribute("href", "/me/password");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });
});
