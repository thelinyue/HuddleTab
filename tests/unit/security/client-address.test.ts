import { afterEach, describe, expect, it } from "vitest";

import { getClientAddress } from "@/server/security/client-address";

const originalTrustProxy = process.env.TRUST_PROXY;

function request(headers: HeadersInit): Request {
  return new Request("http://localhost:5660/api/auth/sign-in/username", {
    headers,
  });
}

afterEach(() => {
  if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = originalTrustProxy;
});

/**
 * 客户端地址边界只由部署者明确声明控制：默认不信任任何转发 Header，
 * 启用后也只接收代理重写的单一 X-Real-IP，避免应用自行猜测代理链。
 */
describe("客户端地址信任边界", () => {
  it("TRUST_PROXY=false 时忽略所有可伪造的转发地址 Header", () => {
    process.env.TRUST_PROXY = "false";

    expect(
      getClientAddress(
        request({
          Forwarded: "for=198.51.100.10",
          "X-Forwarded-For": "198.51.100.11",
          "X-Real-IP": "198.51.100.12",
        }),
      ),
    ).toBeUndefined();
  });

  it.each([["198.51.100.12"], ["2001:db8:1::12"]])(
    "TRUST_PROXY=true 时接受单一合法 X-Real-IP：%s",
    (address) => {
      process.env.TRUST_PROXY = "true";

      expect(getClientAddress(request({ "X-Real-IP": address }))).toBe(address);
    },
  );

  it.each([
    [undefined],
    [""],
    ["   "],
    ["198.51.100.12, 198.51.100.13"],
    ["not-an-ip"],
    ["198.51.100.999"],
    ["for=198.51.100.12"],
  ])("TRUST_PROXY=true 时拒绝无效、空白或合并的 X-Real-IP：%s", (address) => {
    process.env.TRUST_PROXY = "true";
    const headers = new Headers();
    if (address !== undefined) headers.set("X-Real-IP", address);

    expect(getClientAddress(request(headers))).toBeUndefined();
  });

  it("TRUST_PROXY=true 时拒绝重复的 X-Real-IP Header", () => {
    process.env.TRUST_PROXY = "true";
    const headers = new Headers();
    headers.append("X-Real-IP", "198.51.100.12");
    headers.append("X-Real-IP", "198.51.100.13");

    expect(getClientAddress(request(headers))).toBeUndefined();
  });
});
