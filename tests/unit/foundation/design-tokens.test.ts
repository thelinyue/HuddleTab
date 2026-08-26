import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("HuddleTab design tokens", () => {
  const css = readFileSync("src/app/globals.css", "utf8").toLowerCase();

  it("contains the confirmed light and dark primary colors", () => {
    expect(css).toContain("#146b52");
    expect(css).toContain("#5dd6a7");
  });

  it("keeps a visible focus ring token", () => {
    expect(css).toContain("--ring:");
  });
});
