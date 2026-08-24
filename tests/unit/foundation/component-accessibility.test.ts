import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { badgeVariants } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

const componentFiles = [
  "alert-dialog.tsx",
  "badge.tsx",
  "button.tsx",
  "dialog.tsx",
  "dropdown-menu.tsx",
  "input.tsx",
  "select.tsx",
  "sheet.tsx",
  "sonner.tsx",
  "tabs.tsx",
  "textarea.tsx",
] as const;

const sources = Object.fromEntries(
  componentFiles.map((file) => [
    file,
    readFileSync(`src/components/ui/${file}`, "utf8"),
  ]),
) as Record<(typeof componentFiles)[number], string>;

function getFunctionSource(file: keyof typeof sources, functionName: string) {
  const source = sources[file];
  const start = source.indexOf(`function ${functionName}(`);

  if (start < 0) {
    throw new Error(`未找到组件函数：${file}#${functionName}`);
  }

  const nextFunction = source.indexOf("\nfunction ", start + 1);
  const nextExport = source.indexOf("\nexport ", start + 1);
  const candidates = [nextFunction, nextExport].filter((index) => index >= 0);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;

  return source.slice(start, end);
}

function expectFunctionTokens(
  file: keyof typeof sources,
  functionName: string,
  tokens: string[],
) {
  const source = getFunctionSource(file, functionName);

  for (const token of tokens) {
    expect(source, `${file}#${functionName} 应包含 ${token}`).toContain(token);
  }
}

function tailwindSpacingPx(classes: string, axis: "height" | "width") {
  let fixed = 0;
  let minimum = 0;
  const fixedPrefix = axis === "height" ? "h" : "w";
  const minimumPrefix = axis === "height" ? "min-h" : "min-w";

  for (const token of classes.split(/\s+/)) {
    const size = /^size-(\d+)$/.exec(token);
    const fixedAxis = new RegExp(`^${fixedPrefix}-(\\d+)$`).exec(token);
    const minimumAxis = new RegExp(`^${minimumPrefix}-(\\d+)$`).exec(token);

    if (size) fixed = Math.max(fixed, Number(size[1]) * 4);
    if (fixedAxis) fixed = Math.max(fixed, Number(fixedAxis[1]) * 4);
    if (minimumAxis) minimum = Math.max(minimum, Number(minimumAxis[1]) * 4);
  }

  return Math.max(fixed, minimum);
}

describe("HuddleTab component accessibility foundation", () => {
  it("keeps every Button size at least 44px and the default action at 48px", () => {
    const sizes = [
      "default",
      "xs",
      "sm",
      "lg",
      "icon",
      "icon-xs",
      "icon-sm",
      "icon-lg",
    ] as const;

    for (const size of sizes) {
      const classes = buttonVariants({ size });
      expect(
        tailwindSpacingPx(classes, "height"),
        `${size} 高度`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        tailwindSpacingPx(classes, "width"),
        `${size} 宽度`,
      ).toBeGreaterThanOrEqual(44);
    }

    expect(
      tailwindSpacingPx(buttonVariants({ size: "default" }), "height"),
    ).toBeGreaterThanOrEqual(48);
  });

  it("gives form and tab controls a 44px minimum target", () => {
    expectFunctionTokens("input.tsx", "Input", [
      "h-12",
      "border-control-border",
    ]);
    expectFunctionTokens("textarea.tsx", "Textarea", [
      "min-h-16",
      "border-control-border",
    ]);
    expectFunctionTokens("select.tsx", "SelectTrigger", [
      "min-w-11",
      "border-control-border",
      "data-[size=default]:h-12",
      "data-[size=sm]:min-h-11",
    ]);
    expectFunctionTokens("tabs.tsx", "TabsTrigger", ["min-h-11", "min-w-11"]);
  });

  it("gives select and menu choices a 44px minimum target", () => {
    expectFunctionTokens("select.tsx", "SelectItem", ["min-h-11"]);
    expectFunctionTokens("select.tsx", "SelectScrollUpButton", ["min-h-11"]);
    expectFunctionTokens("select.tsx", "SelectScrollDownButton", ["min-h-11"]);
    expectFunctionTokens("dropdown-menu.tsx", "DropdownMenuItem", ["min-h-11"]);
    expectFunctionTokens("dropdown-menu.tsx", "DropdownMenuCheckboxItem", [
      "min-h-11",
    ]);
    expectFunctionTokens("dropdown-menu.tsx", "DropdownMenuRadioItem", [
      "min-h-11",
    ]);
    expectFunctionTokens("dropdown-menu.tsx", "DropdownMenuSubTrigger", [
      "min-h-11",
    ]);
  });

  it("gives headless triggers and exported close controls an effective 44px layout", () => {
    const layoutTokens = [
      "inline-flex",
      "min-h-11",
      "min-w-11",
      "items-center",
      "justify-center",
    ];

    expectFunctionTokens(
      "dropdown-menu.tsx",
      "DropdownMenuTrigger",
      layoutTokens,
    );
    expectFunctionTokens("dialog.tsx", "DialogTrigger", layoutTokens);
    expectFunctionTokens("dialog.tsx", "DialogClose", layoutTokens);
    expectFunctionTokens("sheet.tsx", "SheetTrigger", layoutTokens);
    expectFunctionTokens("sheet.tsx", "SheetClose", layoutTokens);
    expectFunctionTokens(
      "alert-dialog.tsx",
      "AlertDialogTrigger",
      layoutTokens,
    );
  });

  it("preserves asChild prop forwarding on headless controls", () => {
    for (const [file, functionName] of [
      ["dropdown-menu.tsx", "DropdownMenuTrigger"],
      ["dialog.tsx", "DialogTrigger"],
      ["dialog.tsx", "DialogClose"],
      ["sheet.tsx", "SheetTrigger"],
      ["sheet.tsx", "SheetClose"],
      ["alert-dialog.tsx", "AlertDialogTrigger"],
    ] as const) {
      const source = getFunctionSource(file, functionName);
      expect(source).toContain("className={cn(");
      expect(source).toContain("className,");
      expect(source).toContain("{...props}");
    }
  });

  it("keeps dialog, sheet, and toast actions reachable at 44px", () => {
    expectFunctionTokens("dialog.tsx", "DialogContent", ["size-11"]);
    expectFunctionTokens("sheet.tsx", "SheetContent", ["size-11"]);
    expect(sources["sonner.tsx"]).toContain(
      'actionButton: "min-h-11! min-w-11!"',
    );
    expect(sources["sonner.tsx"]).toContain(
      'cancelButton: "min-h-11! min-w-11!"',
    );
    expect(sources["sonner.tsx"]).toContain('closeButton: "size-11!"');
  });

  it("does not let component utilities clear the global focus outline", () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source, `${file} 不应清除 outline`).not.toMatch(
        /\boutline-(?:none|hidden)\b/,
      );
      expect(source, `${file} 不应降低 outline 宽度`).not.toContain(
        "focus-visible:outline-1",
      );
    }
  });

  it("uses the semantic control border on bounded controls", () => {
    expect(buttonVariants({ variant: "outline" }).split(/\s+/)).toContain(
      "border-control-border",
    );
    expect(badgeVariants({ variant: "outline" }).split(/\s+/)).toContain(
      "border-control-border",
    );
  });

  it("uses solid, contrast-safe hover states for primary and destructive actions", () => {
    const primaryButton = buttonVariants({ variant: "default" }).split(/\s+/);
    const primaryBadge = badgeVariants({ variant: "default" }).split(/\s+/);
    const destructiveButton = buttonVariants({ variant: "destructive" }).split(
      /\s+/,
    );
    const destructiveBadge = badgeVariants({ variant: "destructive" }).split(
      /\s+/,
    );

    expect(primaryButton).toContain("hover:bg-primary");
    expect(primaryBadge).toContain("[a]:hover:bg-primary");
    expect(
      primaryButton.some((token) => token.startsWith("hover:bg-primary/")),
    ).toBe(false);
    expect(
      primaryBadge.some((token) => token.startsWith("[a]:hover:bg-primary/")),
    ).toBe(false);

    expect(destructiveButton).toEqual(
      expect.arrayContaining(["hover:bg-background", "hover:underline"]),
    );
    expect(destructiveBadge).toEqual(
      expect.arrayContaining([
        "[a]:hover:bg-transparent",
        "[a]:hover:underline",
      ]),
    );

    for (const source of Object.values(sources)) {
      expect(source).not.toMatch(/(?:hover|focus):bg-destructive\/\d+/);
    }
  });

  it("keeps AlertDialog inside a 320px viewport gutter", () => {
    expectFunctionTokens("alert-dialog.tsx", "AlertDialogContent", [
      "max-w-[calc(100%-2rem)]",
      "sm:max-w-sm",
    ]);
  });
});
