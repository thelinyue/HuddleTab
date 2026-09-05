import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../features/auth/api", () => ({
  useSessionQuery: () => ({ data: { userId: "user-1" } }),
}));
vi.mock("../features/notifications/api", () => ({
  useNotificationsQuery: () => ({ data: { items: [], timeZone: "Asia/Shanghai", unreadCount: 3 } }),
}));

import { ProductBottomNavigation } from "./product-bottom-navigation";

afterEach(cleanup);

describe("ProductBottomNavigation", () => {
  it("通知入口复用未读查询并提供圆点和可访问数量文案", () => {
    render(<MemoryRouter><ProductBottomNavigation /></MemoryRouter>);

    const link = screen.getByRole("link", { name: "通知，3 条未读" });
    expect(link.querySelector(".product-bottom-nav__badge")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" }).querySelectorAll("a")).toHaveLength(3);
  });

  it("系统管理属于我的层级并保持我的导航选中", () => {
    render(<MemoryRouter initialEntries={["/admin/system"]}><ProductBottomNavigation /></MemoryRouter>);

    expect(screen.getByRole("link", { name: "我的" })).toHaveClass("active");
  });
});
