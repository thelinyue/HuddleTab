// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

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

test("Dialog content uses the compact 8px control radius", () => {
  render(
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogHeader><DialogTitle>编辑</DialogTitle></DialogHeader>
      </DialogContent>
    </Dialog>,
  );

  expect(document.querySelector('[data-slot="dialog-content"]')).toHaveClass("rounded-lg");
});

test("bottom Sheet content uses the compact 8px control radius", () => {
  render(
    <Sheet open>
      <SheetContent side="bottom" showCloseButton={false}>
        <SheetHeader><SheetTitle>编辑</SheetTitle></SheetHeader>
      </SheetContent>
    </Sheet>,
  );

  expect(document.querySelector('[data-slot="sheet-content"]')).toHaveClass(
    "data-[side=bottom]:rounded-t-lg",
  );
});
