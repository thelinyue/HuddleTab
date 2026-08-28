// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

afterEach(cleanup);

test("AlertDialog content and footer use the compact 8px control radius", () => {
  render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>操作</AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  );

  expect(
    document.querySelector('[data-slot="alert-dialog-content"]'),
  ).toHaveClass("rounded-lg");
  expect(
    document.querySelector('[data-slot="alert-dialog-footer"]'),
  ).toHaveClass("rounded-b-lg");
});

test("Dialog content uses the compact 8px control radius", () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑</DialogTitle>
        </DialogHeader>
      </DialogContent>
    </Dialog>,
  );

  expect(document.querySelector('[data-slot="dialog-content"]')).toHaveClass(
    "rounded-lg",
  );
  expect(screen.getByRole("button", { name: "关闭" })).toHaveClass("size-11");
});

test("bottom Sheet content uses the compact 8px control radius", () => {
  render(
    <Sheet open>
      <SheetContent side="bottom" showCloseButton={false}>
        <SheetHeader>
          <SheetTitle>编辑</SheetTitle>
        </SheetHeader>
      </SheetContent>
    </Sheet>,
  );

  expect(document.querySelector('[data-slot="sheet-content"]')).toHaveClass(
    "data-[side=bottom]:rounded-t-lg",
  );
});

test("Overlay 只降低背景亮度，不模糊用户用于确认上下文的内容", () => {
  render(
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>版本冲突</DialogTitle>
        </DialogHeader>
      </DialogContent>
    </Dialog>,
  );

  expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass(
    "bg-black/25",
  );
  expect(
    document.querySelector('[data-slot="dialog-overlay"]'),
  ).not.toHaveClass("supports-backdrop-filter:backdrop-blur-xs");
});
