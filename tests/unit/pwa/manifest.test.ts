import { existsSync } from "node:fs";

import sharp from "sharp";
import { expect, it } from "vitest";

import manifest from "@/app/manifest";

it("定义可安装的 HuddleTab Manifest", () => {
  const value = manifest();

  expect(value).toMatchObject({
    name: "伙记 HuddleTab",
    short_name: "伙记",
    description: "一起花，清楚分。",
    start_url: "/activities",
    scope: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#0F766E",
    lang: "zh-CN",
  });
  expect(value.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      }),
      expect.objectContaining({
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      }),
      expect.objectContaining({
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      }),
    ]),
  );
});

it("提交由固定 SVG 生成的 PWA PNG 图标", async () => {
  const icons = [
    ["public/icons/icon-192.png", 192],
    ["public/icons/icon-512.png", 512],
    ["public/icons/icon-maskable-512.png", 512],
  ] as const;

  for (const [path, size] of icons) {
    expect(existsSync(path), `${path} 应提交到仓库`).toBe(true);
    await expect(sharp(path).metadata()).resolves.toMatchObject({
      format: "png",
      width: size,
      height: size,
    });
  }
});
