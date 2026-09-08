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

  it("系统管理属于我的层级并保持我的导航选中", () => {
    render(<MemoryRouter initialEntries={["/admin/system"]}><ProductBottomNavigation /></MemoryRouter>);

    expect(screen.getByRole("link", { name: "我的" })).toHaveClass("active");
  });
});
