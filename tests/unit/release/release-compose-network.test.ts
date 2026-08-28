import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe("四日发布门禁容器网络", () => {
  test("浏览器通过共享网络中的 localhost 获得安全上下文", () => {
    const compose = readFileSync("compose.release-e2e.yaml", "utf8");

    expect(compose).toContain("network_mode: service:app");
    expect(compose.match(/http:\/\/localhost:5660/g)).toHaveLength(4);
    expect(compose).not.toContain("http://huddletab-web:5660");
    expect(compose).not.toContain("http://app:5660");
  });
});
