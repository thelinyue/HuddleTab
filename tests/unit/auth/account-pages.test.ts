import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountPage: vi.fn(() => null),
  accountForm: vi.fn(() => null),
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
  setupRequired: vi.fn(),
}));

vi.mock("@/features/auth/components/account-page", () => ({
  AccountPage: mocks.accountPage,
}));
vi.mock("@/features/auth/components/account-form", () => ({
  AccountForm: mocks.accountForm,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/services/setup-status-service", () => ({
  isSetupRequired: mocks.setupRequired,
}));

import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";

const callbackURL = "/join/secure_invite_token_123";

afterEach(() => {
  vi.clearAllMocks();
});

describe("登录页初始化守卫", () => {
  it("初始化未完成时先重定向，不渲染账户流程", async () => {
    mocks.setupRequired.mockResolvedValueOnce(true);

    await expect(
      LoginPage({ searchParams: Promise.resolve({ callbackURL }) }),
    ).rejects.toThrow("REDIRECT:/setup");

    expect(mocks.redirect).toHaveBeenCalledWith("/setup");
  });

  it("初始化完成后保留登录回调 URL", async () => {
    mocks.setupRequired.mockResolvedValueOnce(false);

    const page = await LoginPage({
      searchParams: Promise.resolve({ callbackURL }),
    });

    expect(page.props.alternateAction).toEqual({
      prompt: "还没有账号？",
      label: "注册新账号",
      href: `/register?callbackURL=${encodeURIComponent(callbackURL)}`,
    });
    expect(page.props.children.props).toEqual({
      mode: "login",
      callbackURL,
    });
  });
});

describe("注册页初始化守卫", () => {
  it("初始化未完成时先重定向，不渲染账户流程", async () => {
    mocks.setupRequired.mockResolvedValueOnce(true);

    await expect(
      RegisterPage({ searchParams: Promise.resolve({ callbackURL }) }),
    ).rejects.toThrow("REDIRECT:/setup");

    expect(mocks.redirect).toHaveBeenCalledWith("/setup");
  });

  it("初始化完成后保留注册回调 URL 和邀请凭证", async () => {
    mocks.setupRequired.mockResolvedValueOnce(false);

    const page = await RegisterPage({
      searchParams: Promise.resolve({ callbackURL }),
    });

    expect(page.props.alternateAction).toEqual({
      label: "已有账号，登录",
      href: `/login?callbackURL=${encodeURIComponent(callbackURL)}`,
    });
    expect(page.props.children.props).toEqual({
      mode: "register",
      callbackURL,
      invitationProof: "secure_invite_token_123",
    });
  });
});
