import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductBottomNavigation } from "./product-bottom-navigation";

afterEach(cleanup);

describe("ProductBottomNavigation", () => {
  it("底部导航只保留活动和我的，不提供通知一级入口", () => {
    render(<MemoryRouter><ProductBottomNavigation /></MemoryRouter>);

    const navigation = screen.getByRole("navigation", { name: "主导航" });
    expect(navigation.querySelectorAll("a")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "活动" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "我的" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /通知/ })).not.toBeInTheDocument();
  });

  it("活动工作台保持活动导航选中", () => {
    render(<MemoryRouter initialEntries={["/activities/demo"]}><ProductBottomNavigation /></MemoryRouter>);

    expect(screen.getByRole("link", { name: "活动" })).toHaveClass("active");
  });

  it("我的页面进入二级菜单后隐藏悬浮胶囊", () => {
    const adminHome = render(<MemoryRouter initialEntries={["/admin"]}><ProductBottomNavigation /></MemoryRouter>);
    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    adminHome.unmount();

    const admin = render(<MemoryRouter initialEntries={["/admin/ai"]}><ProductBottomNavigation /></MemoryRouter>);
    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    admin.unmount();

    render(<MemoryRouter initialEntries={["/me/password"]}><ProductBottomNavigation /></MemoryRouter>);
    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
  });
});
