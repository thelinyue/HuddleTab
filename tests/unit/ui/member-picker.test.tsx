// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  MemberPickerSheet,
  MemberPickerTrigger,
  type MemberPickerMember,
} from "@/features/members/components/member-picker";

const members: readonly MemberPickerMember[] = [
  { id: "m1", displayName: "小王", avatarPreset: 5 },
  { id: "m2", displayName: "小李", avatarPreset: null },
];

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("触发器以统一头像摘要展示单选和多选成员", () => {
  const { rerender } = render(
    <MemberPickerTrigger
      label="谁付款"
      members={members}
      selectedIds={["m1"]}
      onClick={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "谁付款" })).toHaveTextContent(
    "小王",
  );

  rerender(
    <MemberPickerTrigger
      label="谁参与"
      members={members}
      selectedIds={["m1", "m2"]}
      onClick={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "谁参与" })).toHaveTextContent(
    "2 人",
  );
});

test("单选成员后立即提交并关闭面板", async () => {
  const user = userEvent.setup();
  const onCommit = vi.fn();
  const onOpenChange = vi.fn();

  render(
    <MemberPickerSheet
      open
      onOpenChange={onOpenChange}
      title="谁付款"
      mode="single"
      members={members}
      selectedIds={["m1"]}
      onSelectedIdsChange={vi.fn()}
      onCommit={onCommit}
    />,
  );

  await user.click(screen.getByRole("radio", { name: "小李" }));

  expect(onCommit).toHaveBeenCalledWith(["m2"]);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("多选成员只有点击完成才提交当前草稿", async () => {
  const user = userEvent.setup();
  const onCommit = vi.fn();

  function Harness() {
    const [selectedIds, setSelectedIds] = useState<readonly string[]>(["m1"]);
    return (
      <MemberPickerSheet
        open
        onOpenChange={vi.fn()}
        title="谁参与"
        mode="multiple"
        members={members}
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
        onCommit={onCommit}
      />
    );
  }

  render(<Harness />);
  await user.click(screen.getByRole("checkbox", { name: "小李" }));
  expect(onCommit).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "完成" }));
  expect(onCommit).toHaveBeenCalledWith(["m1", "m2"]);
});

test("成员付款金额输入框与选择控件保持在同一网格行", () => {
  render(
    <MemberPickerSheet
      open
      onOpenChange={vi.fn()}
      title="谁付款"
      mode="multiple"
      members={members}
      selectedIds={["m1"]}
      onSelectedIdsChange={vi.fn()}
      onCommit={vi.fn()}
      renderMemberDetails={(member, selected) =>
        selected ? (
          <label data-member-picker-details>
            <span className="sr-only">{member.displayName}付款金额</span>
            <input aria-label={`${member.displayName}付款金额`} />
          </label>
        ) : null
      }
    />,
  );

  const selection = screen.getByRole("checkbox", { name: "小王" });
  const amountInput = screen.getByRole("textbox", { name: "小王付款金额" });
  const row = selection.closest("[data-member-picker-row]");

  expect(row).not.toBeNull();
  expect(row).toHaveClass("grid", "grid-cols-[minmax(0,1fr)_8rem]");
  expect(row?.children).toHaveLength(2);
  expect(row).toContainElement(amountInput);
  expect(row?.lastElementChild).toContainElement(amountInput);
  expect(row?.lastElementChild?.firstElementChild).toHaveAttribute(
    "data-member-picker-details",
  );
});

test("添加临时成员在面板内切换，成功后加入多选草稿", async () => {
  const user = userEvent.setup();
  const onAddGuest = vi.fn().mockResolvedValue({
    id: "m3",
    displayName: "小周",
    avatarPreset: null,
  });

  function Harness() {
    const [selectedIds, setSelectedIds] = useState<readonly string[]>(["m1"]);
    return (
      <MemberPickerSheet
        open
        onOpenChange={vi.fn()}
        title="谁参与"
        mode="multiple"
        members={members}
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
        onCommit={vi.fn()}
        canAddGuest
        online
        onAddGuest={onAddGuest}
      />
    );
  }

  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "添加临时成员" }));
  expect(screen.getByRole("textbox", { name: "临时成员昵称" })).toBeVisible();
  await user.type(
    screen.getByRole("textbox", { name: "临时成员昵称" }),
    "小周",
  );
  await user.click(screen.getByRole("button", { name: "确认添加" }));

  expect(await screen.findByRole("checkbox", { name: "小周" })).toBeChecked();
});

test("离线时保留添加入口并说明需要联网", () => {
  render(
    <MemberPickerSheet
      open
      onOpenChange={vi.fn()}
      title="谁参与"
      mode="multiple"
      members={members}
      selectedIds={["m1"]}
      onSelectedIdsChange={vi.fn()}
      onCommit={vi.fn()}
      canAddGuest
      online={false}
      onAddGuest={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "添加临时成员" })).toBeDisabled();
  expect(screen.getByText("当前离线，联网后可添加")).toBeVisible();
});

test("多选关闭时丢弃草稿并将焦点恢复到统一触发器", async () => {
  const user = userEvent.setup();

  function Harness() {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [committed, setCommitted] = useState<readonly string[]>(["m1"]);
    const [draft, setDraft] = useState<readonly string[]>(committed);
    return (
      <>
        <MemberPickerTrigger
          label="谁参与"
          members={members}
          selectedIds={committed}
          onClick={() => {
            setDraft(committed);
            setOpen(true);
          }}
          buttonRef={triggerRef}
        />
        <MemberPickerSheet
          open={open}
          onOpenChange={setOpen}
          title="谁参与"
          mode="multiple"
          members={members}
          selectedIds={draft}
          onSelectedIdsChange={setDraft}
          onCommit={(ids) => {
            setCommitted(ids);
            setOpen(false);
          }}
          returnFocusRef={triggerRef}
        />
      </>
    );
  }

  render(<Harness />);
  const trigger = screen.getByRole("button", { name: "谁参与" });
  await user.click(trigger);
  await user.click(screen.getByRole("checkbox", { name: "小李" }));
  await user.click(screen.getByRole("button", { name: "关闭" }));

  expect(trigger).toHaveTextContent("小王");
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.click(trigger);
  expect(screen.getByRole("checkbox", { name: "小李" })).not.toBeChecked();
});

test("无成员管理权限时隐藏添加临时成员入口", () => {
  render(
    <MemberPickerSheet
      open
      onOpenChange={vi.fn()}
      title="谁参与"
      mode="multiple"
      members={members}
      selectedIds={["m1"]}
      onSelectedIdsChange={vi.fn()}
      onCommit={vi.fn()}
      online
      onAddGuest={vi.fn()}
    />,
  );

  expect(
    screen.queryByRole("button", { name: "添加临时成员" }),
  ).not.toBeInTheDocument();
});

test("宽屏成员选择器复用 Dialog 而非 Bottom Sheet", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  render(
    <MemberPickerSheet
      open
      onOpenChange={vi.fn()}
      title="谁付款"
      mode="single"
      members={members}
      selectedIds={["m1"]}
      onSelectedIdsChange={vi.fn()}
      onCommit={vi.fn()}
    />,
  );

  expect(screen.getByRole("dialog", { name: "谁付款" })).toHaveAttribute(
    "data-slot",
    "dialog-content",
  );
});
