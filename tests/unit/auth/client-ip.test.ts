import { expect, it } from "vitest";

import { resolveClientIp } from "@/server/security/client-ip";

it("TRUST_PROXY=false 时忽略所有客户端转发地址 Header", () => {
  expect(
    resolveClientIp({
      trustedProxy: false,
      connectionIp: "10.0.0.1",
      headers: new Headers({
        "X-Real-IP": "198.51.100.8",
        "X-Forwarded-For": "198.51.100.9",
        Forwarded: "for=198.51.100.10",
      }),
    }),
  ).toBe("10.0.0.1");
});

it("TRUST_PROXY=true 时只接受单个 X-Real-IP", () => {
  expect(
    resolveClientIp({
      trustedProxy: true,
      connectionIp: "10.0.0.1",
      headers: new Headers({ "X-Real-IP": "198.51.100.8" }),
    }),
  ).toBe("198.51.100.8");
  expect(() =>
    resolveClientIp({
      trustedProxy: true,
      connectionIp: "10.0.0.1",
      headers: new Headers({ "X-Real-IP": "198.51.100.8, 198.51.100.9" }),
    }),
  ).toThrow("可信代理返回的 X-Real-IP 无效。");
});

it("TRUST_PROXY=true 时拒绝缺失、无效和重复的 X-Real-IP", () => {
  for (const headers of [
    new Headers(),
    new Headers({ "X-Real-IP": "not-an-ip" }),
    new Headers([
      ["X-Real-IP", "198.51.100.8"],
      ["X-Real-IP", "198.51.100.9"],
    ]),
  ]) {
    expect(() =>
      resolveClientIp({
        trustedProxy: true,
        connectionIp: "10.0.0.1",
        headers,
      }),
    ).toThrow("可信代理返回的 X-Real-IP 无效。");
  }
});
