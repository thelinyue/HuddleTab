import { existsSync } from "node:fs";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

describe("产品预设图片资源", () => {
  it("提交认证页使用的固定比例本地插画", async () => {
    const path = "public/auth/auth-hero.webp";
    expect(existsSync(path), `${path} 应提交到仓库`).toBe(true);
    await expect(sharp(path).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 950,
      height: 625,
    });
  });

  it("提交六张适合圆形裁切的正方形成员头像", async () => {
    for (let index = 1; index <= 6; index += 1) {
      const path = `public/member-avatars/avatar-${String(index).padStart(2, "0")}.webp`;
      expect(existsSync(path), `${path} 应提交到仓库`).toBe(true);
      await expect(sharp(path).metadata()).resolves.toMatchObject({
        format: "webp",
        width: 256,
        height: 256,
      });
    }
  });

  it("提交六张四比三活动封面", async () => {
    for (let index = 1; index <= 6; index += 1) {
      const path = `public/activity-covers/cover-${String(index).padStart(2, "0")}.webp`;
      expect(existsSync(path), `${path} 应提交到仓库`).toBe(true);
      await expect(sharp(path).metadata()).resolves.toMatchObject({
        format: "webp",
        width: 640,
        height: 480,
      });
    }
  });
});
