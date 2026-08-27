import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("HuddleTab design tokens", () => {
  const css = readFileSync("src/app/globals.css", "utf8").toLowerCase();

  it("contains the confirmed light and dark primary colors", () => {
    expect(css).toContain("#146b52");
    expect(css).toContain("#5dd6a7");
  });

  it("defines the visual foundation swatches and accessible amount colors", () => {
    for (const color of [
      "#5dc0a7",
      "#ffb54d",
      "#ff5c5c",
      "#f1f5f3",
      "#333333",
      "#16745b",
      "#a64b00",
      "#c62828",
      "#f1b968",
      "#ff7b7b",
    ]) {
      expect(css).toContain(color);
    }
  });

  it("keeps a visible focus ring token", () => {
    expect(css).toContain("--ring:");
  });
});
