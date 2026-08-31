// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fromTo: vi.fn(),
  registerPlugin: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@gsap/react", async () => {
  const { useLayoutEffect } =
    await vi.importActual<typeof import("react")>("react");
  return {
    useGSAP: (callback: () => void) => useLayoutEffect(() => callback()),
  };
});
vi.mock("gsap", () => ({
  gsap: {
    fromTo: mocks.fromTo,
    registerPlugin: mocks.registerPlugin,
    set: mocks.set,
  },
}));
vi.mock("gsap/Flip", () => ({ Flip: {} }));

import { AccountForm } from "@/features/auth/components/account-form";
import { SetupForm } from "@/features/setup/components/setup-form";
import { SettlementForm } from "@/features/settlements/components/settlement-form";

function setMotionPreference(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      matches: reducedMotion,
      removeEventListener: vi.fn(),
    })),
  );
}

const settlementContext = {
  activity: {
    id: "activity-1",
    name: "周末旅行",
    currency: "CNY",
    status: "ACTIVE" as const,
    currentMemberId: "member-1",
    currentMemberRole: "OWNER" as const,
    currentMemberStatus: "ACTIVE" as const,
  },
  members: [
    { id: "member-1", displayName: "小王", status: "ACTIVE" as const },
    { id: "member-2", displayName: "小李", status: "ACTIVE" as const },
  ],
  balances: [],
  recommendations: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("登录表单字段按 DOM 顺序入场", () => {
  setMotionPreference(false);
  render(<AccountForm mode="login" />);

  const submit = screen.getByRole("button", { name: "登录" });
  const usernameField = screen
    .getByLabelText("用户名")
    .closest<HTMLElement>("[data-motion-field]");
  const passwordField = screen
    .getByLabelText("密码")
    .closest<HTMLElement>("[data-motion-field]");
  expect(usernameField).not.toBeNull();
  expect(passwordField).not.toBeNull();
  expect(mocks.fromTo).toHaveBeenCalledWith(
    expect.arrayContaining([
      usernameField,
      passwordField,
      submit.parentElement,
    ]),
    { opacity: 0.01, y: 6 },
    {
      duration: 0.28,
      ease: "power1.out",
      opacity: 1,
      stagger: 0.035,
      y: 0,
    },
  );
  const targets = mocks.fromTo.mock.calls[0]?.[0] as HTMLElement[];
  expect(targets.some((target) => target.matches("button, input"))).toBe(false);
});

test("认证校验错误保持 alert 与用户已经填写的字段值", async () => {
  const user = userEvent.setup();
  setMotionPreference(false);
  render(<AccountForm mode="register" />);

  await user.type(screen.getByLabelText("昵称"), "小艾");
  await user.type(screen.getByLabelText("用户名"), "alice");
  await user.type(screen.getByLabelText("密码"), "password123");
  await user.type(screen.getByLabelText("确认密码"), "different123");
  await user.click(screen.getByRole("button", { name: "注册" }));

  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("两次输入的密码不一致。");
  expect(screen.getByLabelText("用户名")).toHaveValue("alice");
  expect(screen.getByLabelText("密码")).toHaveValue("password123");
  expect(mocks.fromTo).toHaveBeenLastCalledWith(
    alert,
    { opacity: 0.01, y: 4 },
    expect.objectContaining({ duration: 0.18, opacity: 1, y: 0 }),
  );
});

test("初始化表单分阶段入场，校验错误不清空受控字段", async () => {
  const user = userEvent.setup();
  setMotionPreference(false);
  render(<SetupForm />);

  const submit = screen.getByRole("button", { name: "完成初始化" });
  expect(mocks.fromTo).toHaveBeenCalledWith(
    expect.arrayContaining([
      screen.getByLabelText("管理员昵称").parentElement,
      submit.parentElement,
    ]),
    { opacity: 0.01, y: 6 },
    expect.objectContaining({ stagger: 0.035 }),
  );
  const targets = mocks.fromTo.mock.calls[0]?.[0] as HTMLElement[];
  expect(targets.some((target) => target.matches("button, input"))).toBe(false);

  await user.type(screen.getByLabelText("管理员昵称"), "管理员");
  await user.type(screen.getByLabelText("用户名"), "admin");
  await user.type(
    screen.getByLabelText("密码", { exact: true }),
    "password123",
  );
  await user.type(screen.getByLabelText("确认密码"), "different123");
  await user.click(screen.getByRole("button", { name: "完成初始化" }));

  expect(screen.getByRole("alert")).toHaveTextContent("两次输入的密码不一致。");
  expect(screen.getByLabelText("管理员昵称")).toHaveValue("管理员");
  expect(screen.getByLabelText("密码", { exact: true })).toHaveValue(
    "password123",
  );
});

test("结算错误 reveal 不移动焦点或重置用户输入", async () => {
  setMotionPreference(false);
  render(
    <SettlementForm
      context={settlementContext}
      timeZone="Asia/Shanghai"
      onSubmit={vi.fn()}
    />,
  );

  const submit = screen.getByRole("button", { name: "确认已支付" });
  const entryTargets = mocks.fromTo.mock.calls[0]?.[0] as HTMLElement[];
  expect(entryTargets).toContain(submit.parentElement);
  expect(entryTargets.some((target) => target.matches("button, input"))).toBe(
    false,
  );
  const amount = screen.getByLabelText("金额");
  fireEvent.change(amount, { target: { value: "88.00" } });
  amount.focus();
  const form = submit.closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form!);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("请选择收款人。");
  expect(amount).toHaveValue("88.00");
  expect(amount).toHaveFocus();
  expect(mocks.fromTo).toHaveBeenLastCalledWith(
    alert,
    { opacity: 0.01, y: 4 },
    expect.objectContaining({ duration: 0.18, opacity: 1, y: 0 }),
  );
});
