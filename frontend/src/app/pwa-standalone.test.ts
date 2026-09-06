import { afterEach, describe, expect, it } from "vitest";

import { installPwaStandaloneState, isPwaStandalone } from "./pwa-standalone";

function media(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(display-mode: standalone)",
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  };
}

afterEach(() => document.documentElement.classList.remove("pwa-standalone"));

describe("PWA 独立模式", () => {
  it("识别 iOS navigator.standalone", () => {
    expect(isPwaStandalone({ standalone: true } as Navigator & { standalone: boolean }, media(false))).toBe(true);
  });

  it("识别 display-mode: standalone", () => {
    expect(isPwaStandalone({ standalone: false } as Navigator & { standalone: boolean }, media(true))).toBe(true);
  });

  it("普通浏览器不设置根状态", () => {
    installPwaStandaloneState(document.documentElement, { standalone: false } as Navigator & { standalone: boolean }, media(false));
    expect(document.documentElement).not.toHaveClass("pwa-standalone");
  });
});
