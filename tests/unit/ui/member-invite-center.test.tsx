// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <MemberInviteCenter {...centerProps({ inviteEnabled: true, onReset })} />,
  );
  expect(
    screen.queryByRole("button", { name: "生成邀请链接" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重置链接" }));
  expect(onReset).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "重置链接" }));
  expect(onReset).toHaveBeenCalledOnce();
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
