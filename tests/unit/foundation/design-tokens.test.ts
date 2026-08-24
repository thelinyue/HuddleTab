import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

function getRuleBody(source: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{`).exec(
    source,
  );

  if (!match) {
    throw new Error(`未找到 CSS 规则：${selector}`);
  }

  const openingBrace = source.indexOf("{", match.index);
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`CSS 规则缺少闭合括号：${selector}`);
}

function getToken(ruleBody: string, token: string) {
  const match = new RegExp(
    `(?:^|\\n)\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`,
  ).exec(ruleBody);

  if (!match) {
    throw new Error(`未找到或未赋值 CSS token：${token}`);
  }

  return match[1].trim();
}

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)
    ?.map((value) => Number.parseInt(value, 16) / 255);

  if (!channels || channels.length !== 3) {
    throw new Error(`颜色不是六位 hex：${hex}`);
  }

  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function compositeHex(foreground: string, background: string, alpha: number) {
  const foregroundChannels = foreground
    .slice(1)
    .match(/../g)
    ?.map((value) => Number.parseInt(value, 16));
  const backgroundChannels = background
    .slice(1)
    .match(/../g)
    ?.map((value) => Number.parseInt(value, 16));

  if (!foregroundChannels || !backgroundChannels) {
    throw new Error("无法合成非 hex 颜色");
  }

  return `#${foregroundChannels
    .map((value, index) =>
      Math.round(value * alpha + backgroundChannels[index] * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
describe("HuddleTab design tokens", () => {
  const light = getRuleBody(css, ":root");
  const dark = getRuleBody(css, ".dark");

  it("binds confirmed primary and ring colors to the correct themes", () => {
    expect(getToken(light, "--primary").toUpperCase()).toBe("#146B52");
    expect(getToken(dark, "--primary").toUpperCase()).toBe("#5DD6A7");
    expect(getToken(light, "--ring")).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(getToken(dark, "--ring")).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("preserves confirmed border tokens and adds a visible control boundary", () => {
    expect(
      getToken(getRuleBody(css, "@theme inline"), "--color-control-border"),
    ).toBe("var(--control-border)");
    expect(getToken(light, "--border").toLowerCase()).toBe("#dce5e0");
    expect(getToken(light, "--input").toLowerCase()).toBe("#dce5e0");
    expect(getToken(dark, "--border").toLowerCase()).toBe("#2a3b34");
    expect(getToken(dark, "--input").toLowerCase()).toBe("#2a3b34");

    for (const [theme, surfaces] of [
      [light, ["--background", "--card", "--muted", "--secondary", "--accent"]],
      [dark, ["--background", "--card", "--muted", "--secondary", "--accent"]],
    ] as const) {
      const controlBorder = getToken(theme, "--control-border");
      expect(controlBorder).toMatch(/^#[0-9A-Fa-f]{6}$/);

      for (const surface of surfaces) {
        expect(
          contrastRatio(controlBorder, getToken(theme, surface)),
        ).toBeGreaterThanOrEqual(3);
      }
    }

    for (const surface of [
      "--background",
      "--card",
      "--muted",
      "--secondary",
      "--accent",
    ] as const) {
      const darkControlFill = compositeHex(
        getToken(dark, "--input"),
        getToken(dark, surface),
        0.3,
      );
      expect
        .soft(
          contrastRatio(getToken(dark, "--control-border"), darkControlFill),
          `dark input/30 on ${surface}`,
        )
        .toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps primary and destructive text contrast safe in both themes", () => {
    for (const theme of [light, dark]) {
      expect(
        contrastRatio(
          getToken(theme, "--primary-foreground"),
          getToken(theme, "--primary"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          getToken(theme, "--destructive"),
          getToken(theme, "--background"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          getToken(theme, "--destructive"),
          getToken(theme, "--card"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("provides a global two pixel focus outline", () => {
    const focus = getRuleBody(css, ":focus-visible");
    expect(focus).toContain("outline: 2px solid var(--ring);");
    expect(focus).toContain("outline-offset: 2px;");
  });

  it("stops non-essential motion when reduced motion is requested", () => {
    const reducedMotion = getRuleBody(
      css,
      "@media (prefers-reduced-motion: reduce)",
    );
    expect(reducedMotion).toContain("scroll-behavior: auto !important;");
    expect(reducedMotion).toContain("animation-duration: 1ms !important;");
    expect(reducedMotion).toContain("animation-iteration-count: 1 !important;");
    expect(reducedMotion).toContain("transition-duration: 1ms !important;");
  });

  it("keeps money values aligned with tabular numerals", () => {
    expect(getRuleBody(css, ".money")).toContain(
      "font-variant-numeric: tabular-nums;",
    );
  });
});
