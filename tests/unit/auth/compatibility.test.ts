import { describe, expect, it } from "vitest";

import {
  createSyntheticEmail,
  isSyntheticEmail,
} from "@/server/auth/synthetic-email";
import { normalizeUsername } from "@/server/auth/username";

describe("认证兼容层", () => {
  it("为 Profile 与 Better Auth 使用同一个规范化用户名", () => {
    expect(normalizeUsername("  Alice_01  ")).toBe("alice_01");
    expect(() => normalizeUsername("a@b")).toThrow("用户名不能包含空白或 @");
  });

  it("创建不可投递且仅供内部使用的邮箱身份", () => {
    const email = createSyntheticEmail("018f1f67-5b1e-7f41-b0d1-3a013d9c9001");

    expect(email).toBe("u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid");
    expect(isSyntheticEmail(email)).toBe(true);
    expect(isSyntheticEmail("real@example.com")).toBe(false);
  });
});
