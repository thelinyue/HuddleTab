// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import type { AvatarPreset } from "@/features/me/avatar-presets";

const api = vi.hoisted(() => ({
  getMeProfile: vi.fn(),
  updateMeProfile: vi.fn(),
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("@/features/me/api", () => api);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { ProfilePage } from "@/features/me/components/profile-page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderProfile({
  avatarPreset = 2,
}: {
  readonly avatarPreset?: AvatarPreset | null;
} = {}) {
  api.getMeProfile.mockResolvedValue({
    nickname: "林樾",
    username: "linyue",
    emailBound: true,
    maskedEmail: "l***@example.com",
    emailVerified: true,
    avatarPreset,
    themePreference: "SYSTEM",
    isSystemAdmin: false,
  });

  return render(<ProfilePage />);
}

test("个人资料页展示返回导航、资料字段与六个头像单选项", async () => {
  renderProfile();

  expect(
    await screen.findByRole("heading", { name: "个人资料" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "返回" })).toHaveAttribute(
    "href",
    "/me",
  );
  expect(screen.getByRole("img", { name: "当前的头像" })).toBeVisible();
  expect(screen.getAllByRole("radio", { name: /头像/ })).toHaveLength(6);
  expect(screen.getByRole("radio", { name: "头像 2" })).toBeChecked();
  expect(screen.getByLabelText("用户名")).toHaveAttribute("readonly");
  expect(screen.getByText("系统唯一标识，暂不支持修改。")).toBeVisible();
  expect(screen.getByRole("button", { name: "保存" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "退出登录" })).not.toBeInTheDocument();
  expect(document.querySelector('a[href="/me/theme"]')).not.toBeInTheDocument();
});

test("保存时发送昵称和头像预设，并返回我的主页", async () => {
  const user = userEvent.setup();
  api.updateMeProfile.mockResolvedValue(undefined);
  renderProfile();

  await user.click(await screen.findByRole("radio", { name: "头像 5" }));
  expect(
    within(screen.getByRole("img", { name: "当前的头像" })).getByRole(
      "presentation",
    ),
  ).toHaveAttribute("src", "/member-avatars/avatar-05.webp");
  const nickname = screen.getByLabelText("昵称");
  await user.clear(nickname);
  await user.type(nickname, "新昵称");
  await user.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(() => {
    expect(api.updateMeProfile).toHaveBeenCalledWith({
      nickname: "新昵称",
      avatarPreset: 5,
    });
    expect(router.replace).toHaveBeenCalledWith("/me");
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});

test("保存失败时保留昵称和头像选择，并显示中文错误", async () => {
  const user = userEvent.setup();
  api.updateMeProfile.mockRejectedValue(
    new Error("个人资料保存失败，请稍后重试。"),
  );
  renderProfile();

  await user.click(await screen.findByRole("radio", { name: "头像 5" }));
  const nickname = screen.getByLabelText("昵称");
  await user.clear(nickname);
  await user.type(nickname, "新昵称");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "个人资料保存失败，请稍后重试。",
  );
  expect(nickname).toHaveValue("新昵称");
  expect(screen.getByRole("radio", { name: "头像 5" })).toBeChecked();
  expect(router.replace).not.toHaveBeenCalled();
});

test("历史账户只改昵称时保留哈希头像并省略头像字段", async () => {
  const user = userEvent.setup();
  api.updateMeProfile.mockResolvedValue(undefined);
  renderProfile({ avatarPreset: null });

  expect(
    within(await screen.findByRole("img", { name: "当前的头像" })).getByRole(
      "presentation",
    ),
  ).toHaveAttribute("src", "/member-avatars/avatar-03.webp");
  expect(screen.getByRole("radio", { name: "头像 2" })).not.toBeChecked();

  const nickname = screen.getByLabelText("昵称");
  await user.clear(nickname);
  await user.type(nickname, "历史昵称");
  await user.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(() => {
    expect(api.updateMeProfile).toHaveBeenCalledWith({ nickname: "历史昵称" });
  });
});
