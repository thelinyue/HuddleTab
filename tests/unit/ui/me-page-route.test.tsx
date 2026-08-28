// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const profilePage = vi.hoisted(() => vi.fn());

vi.mock("@/features/me/components/profile-page", () => ({
  ProfilePage: () => {
    profilePage();
    return <p>个人资料路由</p>;
  },
}));

import ProfileRoute from "@/app/(product)/me/profile/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("个人资料路由渲染资料编辑页面", () => {
  render(<ProfileRoute />);

  expect(screen.getByText("个人资料路由")).toBeVisible();
  expect(profilePage).toHaveBeenCalledTimes(1);
});
