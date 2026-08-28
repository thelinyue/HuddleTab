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

  it("freezes the V1 font and semantic typography roles", () => {
    expect(css).toContain('"noto sans sc"');
    expect(css).toContain('"inter"');
    expect(css).toContain("--font-amount:");
    expect(css).toContain("--text-display-amount: 2rem;");
    expect(css).toContain("--text-display-amount--line-height: 2.5rem;");
    expect(css).toContain("--text-page-title: 1.25rem;");
    expect(css).toContain("--text-section-title: 0.9375rem;");
    expect(css).toContain("--text-body: 0.875rem;");
    expect(css).toContain("--text-label: 0.8125rem;");
    expect(css).toContain("--text-caption: 0.75rem;");
    for (const role of [
      "display-amount",
      "amount-lg",
      "amount",
      "page-title",
      "section-title",
      "body",
      "label",
      "caption",
    ]) {
      expect(css).toContain(`.type-${role}`);
    }
  });

  it("keeps brand, balance and success semantics independent", () => {
    expect(css).toContain("--brand:");
    expect(css).toContain("--amount-receivable:");
    expect(css).toContain("--amount-payable:");
    expect(css).toContain("--success:");
  });

  it("defines the V1 radius scale", () => {
    expect(css).toContain("--radius-sm: 0.5rem;");
    expect(css).toContain("--radius-md: 0.75rem;");
    expect(css).toContain("--radius-lg: 1rem;");
  });
});
