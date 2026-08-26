import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";

describe("基础交互组件", () => {
  it("keeps the default button at the mobile minimum touch target", () => {
    expect(buttonVariants()).toContain("min-h-11");
  });
});
