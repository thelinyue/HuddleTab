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
import QRCode from "qrcode";

import { MemberInviteCenter } from "@/features/members/components/member-invite-center";
import { MemberList } from "@/features/members/components/member-list";

const token = "a".repeat(32);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function centerProps(
  overrides: Partial<Parameters<typeof MemberInviteCenter>[0]> = {},
) {
  return {
    inviteUrl: null,
    inviteEnabled: false,
    online: true,
    loading: false,
    error: null,
    notice: null,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onReset: vi.fn().mockResolvedValue(undefined),
    onDisable: vi.fn().mockResolvedValue(undefined),
    onNotice: vi.fn(),
    ...overrides,
  };
}

test("没有启用链接时只显示生成操作", () => {
  render(<MemberInviteCenter {...centerProps()} />);
  expect(screen.getByRole("button", { name: "生成邀请链接" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "重置链接" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "关闭邀请" }),
  ).not.toBeInTheDocument();
});

test("无明文但已有启用链接时只能确认后重置", async () => {
  const user = userEvent.setup();
  const onReset = vi.fn().mockResolvedValue(undefined);
  render(
    <MemberInviteCenter {...centerProps({ inviteEnabled: true, onReset })} />,
  );
  expect(
    screen.queryByRole("button", { name: "生成邀请链接" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重置链接" }));
  expect(
    screen.getByRole("alertdialog", { name: "重置邀请链接" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(onReset).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "重置链接" }));
  await user.click(screen.getByRole("button", { name: "确认重置" }));
  await waitFor(() => expect(onReset).toHaveBeenCalledOnce());
});

test("在线链接支持二维码、分享和复制，二维码内容与邀请 URL 相同", async () => {
  const user = userEvent.setup();
  const inviteUrl = `/join/${token}`;
  const writeText = vi.fn().mockResolvedValue(undefined);
  const share = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: share,
  });
  const onNotice = vi.fn();
  const qrSpy = vi
    .spyOn(QRCode, "toDataURL")
    .mockResolvedValue("data:image/png;base64,test" as never);
  render(
    <MemberInviteCenter
      {...centerProps({ inviteUrl, inviteEnabled: true, onNotice })}
    />,
  );
  await waitFor(() =>
    expect(screen.getByAltText("邀请链接二维码")).toBeVisible(),
  );
  expect(qrSpy).toHaveBeenCalledWith(inviteUrl, { width: 192, margin: 1 });
  await user.click(screen.getByRole("button", { name: "分享" }));
  expect(share).toHaveBeenCalledWith({
    title: "加入活动",
    text: "点击链接加入活动",
    url: inviteUrl,
  });
  await user.click(screen.getByRole("button", { name: "复制链接" }));
  expect(writeText).toHaveBeenCalledWith(inviteUrl);
  expect(onNotice).toHaveBeenCalled();
});

test("不支持系统分享时回退复制，取消分享不提示失败；离线仍可分享但禁用写操作", async () => {
  const user = userEvent.setup();
  const inviteUrl = `/join/${token}`;
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")),
  });
  const onNotice = vi.fn();
  render(
    <MemberInviteCenter
      {...centerProps({
        inviteUrl,
        inviteEnabled: true,
        online: false,
        onNotice,
      })}
    />,
  );
  expect(screen.getByRole("button", { name: "分享" })).not.toBeDisabled();
  expect(screen.getByRole("button", { name: "复制链接" })).not.toBeDisabled();
  expect(screen.getByRole("button", { name: "关闭邀请" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "重置链接" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "可继续复制或分享当前链接；生成、重置和关闭需要联网，不会排队。",
  );
  await user.click(screen.getByRole("button", { name: "分享" }));
  expect(onNotice).not.toHaveBeenCalled();

  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: undefined,
  });
  await user.click(screen.getByRole("button", { name: "分享" }));
  expect(writeText).toHaveBeenCalledWith(inviteUrl);
});

test("系统分享非取消异常会明确提示失败", async () => {
  const user = userEvent.setup();
  const inviteUrl = `/join/${token}`;
  const onNotice = vi.fn();
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: vi
      .fn()
      .mockRejectedValue(new DOMException("blocked", "NotAllowedError")),
  });
  render(
    <MemberInviteCenter
      {...centerProps({ inviteUrl, inviteEnabled: true, onNotice })}
    />,
  );

  await user.click(screen.getByRole("button", { name: "分享" }));
  expect(onNotice).toHaveBeenCalledWith("系统分享失败，请复制邀请链接后发送。");
});

test("打开成员邀请中心不会自动 POST，普通成员不渲染邀请动作", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn().mockResolvedValue(`/join/${token}`);
  const owner = {
    id: "owner",
    displayName: "Owner",
    role: "OWNER" as const,
    status: "ACTIVE" as const,
    memberType: "USER" as const,
    permissions: { canManage: true },
  };
  render(
    <MemberList
      members={[owner]}
      inviteMode="DIRECT_JOIN"
      embedded
      onCreateInvite={onCreate}
      onDisableInvite={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  await user.click(screen.getByRole("button", { name: "邀请成员" }));
  expect(onCreate).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "生成邀请链接" }));
  expect(onCreate).toHaveBeenCalledWith(false);

  cleanup();
  render(
    <MemberList
      members={[
        { ...owner, role: "MEMBER", permissions: { canManage: false } },
      ]}
      inviteMode="DIRECT_JOIN"
      onCreateInvite={onCreate}
      onDisableInvite={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "邀请成员" }),
  ).not.toBeInTheDocument();
});

test("重置和关闭邀请使用独立确认层，取消不触发操作", async () => {
  const user = userEvent.setup();
  const onReset = vi.fn().mockResolvedValue(undefined);
  const onDisable = vi.fn().mockResolvedValue(undefined);
  render(
    <MemberInviteCenter
      {...centerProps({
        inviteUrl: `/join/${token}`,
        inviteEnabled: true,
        onReset,
        onDisable,
      })}
    />,
  );

  await user.click(screen.getByRole("button", { name: "重置链接" }));
  const resetDialog = screen.getByRole("alertdialog", {
    name: "重置邀请链接",
  });
  expect(resetDialog).toHaveTextContent("旧邀请链接会立即失效");
  await user.click(within(resetDialog).getByRole("button", { name: "取消" }));
  expect(onReset).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "关闭邀请" }));
  const disableDialog = screen.getByRole("alertdialog", {
    name: "关闭邀请",
  });
  expect(disableDialog).toHaveTextContent("当前邀请链接将立即失效");
  await user.click(
    within(disableDialog).getByRole("button", { name: "确认关闭" }),
  );
  expect(onDisable).toHaveBeenCalledOnce();
});

test("MemberList 重置邀请失败时确认层保持打开并显示错误", async () => {
  const user = userEvent.setup();
  const onCreateInvite = vi
    .fn()
    .mockResolvedValueOnce(`/join/${token}`)
    .mockRejectedValueOnce(new Error("重置接口失败"));
  const owner = {
    id: "owner",
    displayName: "Owner",
    role: "OWNER" as const,
    status: "ACTIVE" as const,
    memberType: "USER" as const,
    permissions: { canManage: true },
  };

  render(
    <MemberList
      members={[owner]}
      inviteMode="DIRECT_JOIN"
      embedded
      onCreateInvite={onCreateInvite}
      onDisableInvite={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  await user.click(screen.getByRole("button", { name: "邀请成员" }));
  await user.click(screen.getByRole("button", { name: "生成邀请链接" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "重置链接" })).toBeVisible(),
  );
  await user.click(screen.getByRole("button", { name: "重置链接" }));
  const dialog = screen.getByRole("alertdialog", { name: "重置邀请链接" });
  await user.click(within(dialog).getByRole("button", { name: "确认重置" }));

  await waitFor(() => {
    expect(screen.getByRole("alertdialog", { name: "重置邀请链接" })).toBeVisible();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("重置接口失败");
  });
});

test("MemberList 关闭邀请失败时确认层保持打开并显示错误", async () => {
  const user = userEvent.setup();
  const onCreateInvite = vi.fn().mockResolvedValue(`/join/${token}`);
  const onDisableInvite = vi.fn().mockRejectedValue(new Error("关闭接口失败"));
  const owner = {
    id: "owner",
    displayName: "Owner",
    role: "OWNER" as const,
    status: "ACTIVE" as const,
    memberType: "USER" as const,
    permissions: { canManage: true },
  };

  render(
    <MemberList
      members={[owner]}
      inviteMode="DIRECT_JOIN"
      embedded
      onCreateInvite={onCreateInvite}
      onDisableInvite={onDisableInvite}
    />,
  );

  await user.click(screen.getByRole("button", { name: "邀请成员" }));
  await user.click(screen.getByRole("button", { name: "生成邀请链接" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "关闭邀请" })).toBeVisible(),
  );
  await user.click(screen.getByRole("button", { name: "关闭邀请" }));
  const dialog = screen.getByRole("alertdialog", { name: "关闭邀请" });
  await user.click(within(dialog).getByRole("button", { name: "确认关闭" }));

  await waitFor(() => {
    expect(screen.getByRole("alertdialog", { name: "关闭邀请" })).toBeVisible();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("关闭接口失败");
  });
});

test("嵌入成员流程使用单一导航 Overlay，邀请视图 Back 回成员根视图", async () => {
  const user = userEvent.setup();
  const owner = {
    id: "owner",
    displayName: "Owner",
    role: "OWNER" as const,
    status: "ACTIVE" as const,
    memberType: "USER" as const,
    permissions: { canManage: true },
  };
  render(
    <MemberList
      members={[owner]}
      inviteMode="DIRECT_JOIN"
      embedded
      onCreateInvite={vi.fn().mockResolvedValue(`/join/${token}`)}
      onDisableInvite={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  const rootDialog = screen.getByRole("dialog", { name: "成员" });
  await user.click(screen.getByRole("button", { name: "邀请成员" }));
  expect(screen.getByRole("dialog", { name: "邀请成员" })).toBe(rootDialog);
  expect(screen.getAllByRole("heading", { name: "邀请成员" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "返回成员" })).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "返回成员列表" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "返回成员" }));
  expect(screen.getByRole("dialog", { name: "成员" })).toBe(rootDialog);
});

test("嵌入成员面板重新打开时按入口视图进入邀请页", async () => {
  const owner = {
    id: "owner",
    displayName: "Owner",
    role: "OWNER" as const,
    status: "ACTIVE" as const,
    memberType: "USER" as const,
    permissions: { canManage: true },
  };
  const props = {
    members: [owner],
    inviteMode: "DIRECT_JOIN" as const,
    embedded: true,
    onCreateInvite: vi.fn().mockResolvedValue(`/join/${token}`),
    onDisableInvite: vi.fn().mockResolvedValue(undefined),
  };
  const { rerender } = render(
    <MemberList {...props} embeddedOpen={false} initialView="list" />,
  );

  rerender(<MemberList {...props} embeddedOpen initialView="invite" />);

  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "邀请成员" })).toBeVisible(),
  );
});
