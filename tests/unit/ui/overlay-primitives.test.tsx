// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render } from "@testing-library/react";
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
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>编辑</DialogTitle>
        </DialogHeader>
      </DialogContent>
    </Dialog>,
  );

  expect(document.querySelector('[data-slot="dialog-content"]')).toHaveClass(
    "rounded-lg",
  );
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
