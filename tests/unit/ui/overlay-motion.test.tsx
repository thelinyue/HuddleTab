// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { gsap } from "gsap";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const animationControl = {
  exitCompletions: [] as Array<() => void>,
  exitTweens: [] as Array<ReturnType<typeof gsap.to>>,
};

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

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

function finishExit() {
  const complete = animationControl.exitCompletions.at(-1);
  expect(complete).toBeTypeOf("function");
  act(() => complete?.());
}

function expectClosing(content: HTMLElement, slot: string) {
  expect(document.querySelector(`[data-slot="${slot}"]`)).toBe(content);
  expect(content).toHaveAttribute("inert");
  expect(content).toHaveStyle({ pointerEvents: "none" });
}

beforeEach(() => {
  setMotionPreference(false);
  const realFromTo = gsap.fromTo.bind(gsap) as (
    targets: GSAPTweenTarget,
    fromVars: GSAPTweenVars,
    toVars: GSAPTweenVars,
  ) => GSAPTween;
  const realTo = gsap.to.bind(gsap) as (
    targets: GSAPTweenTarget,
    vars: GSAPTweenVars,
  ) => GSAPTween;

  vi.spyOn(gsap, "fromTo").mockImplementation(((
    targets: GSAPTweenTarget,
    fromVars: GSAPTweenVars,
    toVars: GSAPTweenVars,
  ) =>
    realFromTo(targets, fromVars, {
      ...toVars,
      paused: true,
    })) as typeof gsap.fromTo);
  vi.spyOn(gsap, "set");
  vi.spyOn(gsap, "to").mockImplementation((targets, vars) => {
    const onComplete = vars.onComplete as (() => void) | undefined;
    const tween = realTo(targets, {
      ...vars,
      onComplete: undefined,
      paused: true,
    });
    if (onComplete) {
      animationControl.exitCompletions.push(onComplete);
      animationControl.exitTweens.push(tween);
    }
    return tween;
  });
});

afterEach(() => {
  cleanup();
  animationControl.exitCompletions.length = 0;
  animationControl.exitTweens.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each([
  {
    contentSlot: "dialog-content",
    overlaySlot: "dialog-overlay",
    renderPrimitive: () =>
      render(
        <Dialog open>
          <DialogContent showCloseButton={false}>
            <DialogTitle>编辑记录</DialogTitle>
            <DialogDescription>修改记录内容</DialogDescription>
          </DialogContent>
        </Dialog>,
      ),
    role: "dialog" as const,
  },
  {
    contentSlot: "sheet-content",
    overlaySlot: "sheet-overlay",
    renderPrimitive: () =>
      render(
        <Sheet open>
          <SheetContent side="bottom" showCloseButton={false}>
            <SheetTitle>移动表单</SheetTitle>
            <SheetDescription>填写移动表单</SheetDescription>
          </SheetContent>
        </Sheet>,
      ),
    role: "dialog" as const,
  },
  {
    contentSlot: "alert-dialog-content",
    overlaySlot: "alert-dialog-overlay",
    renderPrimitive: () =>
      render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>删除后无法恢复</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>,
      ),
    role: "alertdialog" as const,
  },
])(
  "$contentSlot 打开时保留 Radix role，并只补间当前 Portal 的遮罩和内容",
  ({ contentSlot, overlaySlot, renderPrimitive, role }) => {
    renderPrimitive();

    const content = screen.getByRole(role);
    const overlay = document.querySelector(`[data-slot="${overlaySlot}"]`);
    expect(content).toHaveAttribute("data-slot", contentSlot);
    expect(overlay).toBeInstanceOf(HTMLDivElement);
    expect(gsap.fromTo).toHaveBeenCalledWith(
      overlay,
      { autoAlpha: 0 },
      expect.objectContaining({ autoAlpha: 1 }),
    );
    expect(gsap.fromTo).toHaveBeenCalledWith(
      content,
      expect.objectContaining({ autoAlpha: 0 }),
      expect.objectContaining({ autoAlpha: 1 }),
    );
  },
);

test("bottom Sheet 从对应的 y 方向进入，不补间布局属性", () => {
  render(
    <Sheet open>
      <SheetContent side="bottom" showCloseButton={false}>
        <SheetTitle>底部表单</SheetTitle>
        <SheetDescription>填写表单</SheetDescription>
      </SheetContent>
    </Sheet>,
  );

  const content = screen.getByRole("dialog");
  const contentTween = vi
    .mocked(gsap.fromTo)
    .mock.calls.find(([target]) => target === content);
  expect(contentTween?.[1]).toEqual(
    expect.objectContaining({ autoAlpha: 0, x: 0, y: 24 }),
  );
  expect(contentTween?.[2]).not.toEqual(
    expect.objectContaining({ height: expect.anything() }),
  );
  expect(contentTween?.[2]).not.toEqual(
    expect.objectContaining({ top: expect.anything() }),
  );
});

test.each([
  {
    contentSlot: "dialog-content",
    overlaySlot: "dialog-overlay",
    renderPrimitive: () =>
      render(
        <Dialog open>
          <DialogContent showCloseButton={false}>
            <DialogTitle>编辑记录</DialogTitle>
          </DialogContent>
        </Dialog>,
      ),
  },
  {
    contentSlot: "sheet-content",
    overlaySlot: "sheet-overlay",
    renderPrimitive: () =>
      render(
        <Sheet open>
          <SheetContent side="bottom" showCloseButton={false}>
            <SheetTitle>移动表单</SheetTitle>
          </SheetContent>
        </Sheet>,
      ),
  },
  {
    contentSlot: "alert-dialog-content",
    overlaySlot: "alert-dialog-overlay",
    renderPrimitive: () =>
      render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>,
      ),
  },
])(
  "$contentSlot 在减少动态效果时直接设置当前 Portal 的最终状态",
  ({ contentSlot, overlaySlot, renderPrimitive }) => {
    setMotionPreference(true);
    renderPrimitive();

    const content = document.querySelector(`[data-slot="${contentSlot}"]`);
    const overlay = document.querySelector(`[data-slot="${overlaySlot}"]`);
    expect(gsap.set).toHaveBeenCalledWith(
      overlay,
      expect.objectContaining({ autoAlpha: 1 }),
    );
    expect(gsap.set).toHaveBeenCalledWith(
      content,
      expect.objectContaining({ autoAlpha: 1, x: 0, y: 0 }),
    );
    expect(gsap.fromTo).not.toHaveBeenCalled();
    expect(gsap.to).not.toHaveBeenCalled();
  },
);

test("Dialog 关闭按钮在离场完成前保留不可交互内容，完成后卸载并恢复触发器焦点", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  render(
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger>打开编辑</DialogTrigger>
      <DialogContent>
        <DialogTitle>编辑记录</DialogTitle>
        <DialogDescription>修改记录内容</DialogDescription>
      </DialogContent>
    </Dialog>,
  );

  const trigger = screen.getByRole("button", { name: "打开编辑" });
  await user.click(trigger);
  const content = screen.getByRole("dialog");
  await user.click(screen.getByRole("button", { name: "关闭" }));

  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expectClosing(content, "dialog-content");
  finishExit();
  expect(content).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("bottom Sheet 点击遮罩后延迟卸载，完成后恢复触发器焦点", async () => {
  const user = userEvent.setup();
  render(
    <Sheet>
      <SheetTrigger>打开移动表单</SheetTrigger>
      <SheetContent side="bottom" showCloseButton={false}>
        <SheetTitle>移动表单</SheetTitle>
        <SheetDescription>填写移动表单</SheetDescription>
      </SheetContent>
    </Sheet>,
  );

  const trigger = screen.getByRole("button", { name: "打开移动表单" });
  await user.click(trigger);
  const content = screen.getByRole("dialog");
  const overlay = document.querySelector('[data-slot="sheet-overlay"]');
  expect(overlay).toBeInstanceOf(HTMLDivElement);
  await user.click(overlay as HTMLDivElement);

  expectClosing(content, "sheet-content");
  expect(overlay).toHaveStyle({ pointerEvents: "none" });
  finishExit();
  expect(content).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("AlertDialog 按 Esc 后延迟卸载，完成后恢复触发器焦点", async () => {
  const user = userEvent.setup();
  render(
    <AlertDialog>
      <AlertDialogTrigger>打开删除确认</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>确认删除</AlertDialogTitle>
        <AlertDialogDescription>删除后无法恢复</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  );

  const trigger = screen.getByRole("button", { name: "打开删除确认" });
  await user.click(trigger);
  const content = screen.getByRole("alertdialog");
  await user.keyboard("{Escape}");

  expectClosing(content, "alert-dialog-content");
  finishExit();
  expect(content).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("AlertDialog 点击遮罩仍不会关闭", async () => {
  const user = userEvent.setup();
  render(
    <AlertDialog>
      <AlertDialogTrigger>打开删除确认</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>确认删除</AlertDialogTitle>
        <AlertDialogDescription>删除后无法恢复</AlertDialogDescription>
        <AlertDialogCancel>取消</AlertDialogCancel>
      </AlertDialogContent>
    </AlertDialog>,
  );

  await user.click(screen.getByRole("button", { name: "打开删除确认" }));
  const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]');
  expect(overlay).toBeInstanceOf(HTMLDivElement);
  fireEvent.pointerDown(overlay as HTMLDivElement, {
    button: 0,
    pointerType: "mouse",
  });

  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  expect(animationControl.exitCompletions).toHaveLength(0);
});

test("减少动态效果时关闭不启动补间，也不延迟卸载", async () => {
  setMotionPreference(true);
  const user = userEvent.setup();
  render(
    <Dialog>
      <DialogTrigger>打开编辑</DialogTrigger>
      <DialogContent>
        <DialogTitle>编辑记录</DialogTitle>
      </DialogContent>
    </Dialog>,
  );

  const trigger = screen.getByRole("button", { name: "打开编辑" });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "关闭" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(gsap.to).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
});

test("受控 Dialog 在离场中重新打开会取消卸载，并保持单一可用内容", () => {
  const onOpenChange = vi.fn();
  const renderDialog = (open: boolean) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger>打开编辑</DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogTitle>编辑记录</DialogTitle>
        <DialogDescription>修改记录内容</DialogDescription>
      </DialogContent>
    </Dialog>
  );
  const { rerender } = render(renderDialog(true));
  const content = screen.getByRole("dialog");

  rerender(renderDialog(false));
  expectClosing(content, "dialog-content");
  const staleExit = animationControl.exitCompletions.at(-1);
  const staleExitTween = animationControl.exitTweens.at(-1);

  rerender(renderDialog(true));
  const reopenedContent = screen.getByRole("dialog");
  expect(reopenedContent).toBe(content);
  expect(reopenedContent).not.toHaveAttribute("inert");
  expect(staleExitTween?.parent).toBeNull();
  expect(
    document.querySelectorAll('[data-slot="dialog-content"]'),
  ).toHaveLength(1);

  act(() => staleExit?.());
  expect(screen.getByRole("dialog")).toBe(content);
  expect(content).not.toHaveAttribute("inert");
});

test("上一轮离场完成回调不能在第二轮关闭时提前卸载内容", () => {
  const renderDialog = (open: boolean) => (
    <Dialog open={open} onOpenChange={vi.fn()}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>编辑记录</DialogTitle>
      </DialogContent>
    </Dialog>
  );
  const { rerender } = render(renderDialog(true));
  const content = screen.getByRole("dialog");

  rerender(renderDialog(false));
  const firstExit = animationControl.exitCompletions.at(-1);
  rerender(renderDialog(true));
  rerender(renderDialog(false));
  const secondExit = animationControl.exitCompletions.at(-1);

  act(() => firstExit?.());
  expectClosing(content, "dialog-content");

  act(() => secondExit?.());
  expect(content).not.toBeInTheDocument();
});

test("非模态 Dialog 没有遮罩时仍延迟卸载并恢复触发器焦点", async () => {
  const user = userEvent.setup();
  render(
    <Dialog modal={false}>
      <DialogTrigger>打开非模态编辑</DialogTrigger>
      <DialogContent>
        <DialogTitle>非模态编辑</DialogTitle>
      </DialogContent>
    </Dialog>,
  );

  const trigger = screen.getByRole("button", { name: "打开非模态编辑" });
  await user.click(trigger);
  const content = screen.getByRole("dialog");
  expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();

  await user.click(screen.getByRole("button", { name: "关闭" }));
  expectClosing(content, "dialog-content");
  finishExit();

  expect(content).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});
