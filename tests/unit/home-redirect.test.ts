import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import HomePage from "@/app/page";

test("初始化完成后根路径进入登录页", () => {
  HomePage();
  expect(mocks.redirect).toHaveBeenCalledWith("/login");
});
