import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setupRequired: vi.fn() }));

vi.mock("@/server/services/setup-status-service", () => ({
  isSetupRequired: mocks.setupRequired,
}));

import { proxy } from "@/proxy";

describe("首次初始化路由", () => {
  beforeEach(() => {
    mocks.setupRequired.mockReset();
  });

  it("未初始化时将产品深链转到初始化页面", async () => {
    mocks.setupRequired.mockResolvedValueOnce(true);

    const response = await proxy(
      new NextRequest("http://localhost/activities/example"),
    );

    expect(response.headers.get("location")).toBe("http://localhost/setup");
  });

  it("初始化页面、API 和 PWA 静态资源不参与重定向", async () => {
    await expect(
      proxy(new NextRequest("http://localhost/setup")),
    ).resolves.toBeDefined();
    await expect(
      proxy(new NextRequest("http://localhost/api/setup")),
    ).resolves.toBeDefined();
    await expect(
      proxy(new NextRequest("http://localhost/icons/icon-192.png")),
    ).resolves.toBeDefined();
    await expect(
      proxy(new NextRequest("http://localhost/member-avatars/avatar-01.webp")),
    ).resolves.toBeDefined();
    await expect(
      proxy(new NextRequest("http://localhost/activity-covers/cover-01.webp")),
    ).resolves.toBeDefined();
    expect(mocks.setupRequired).not.toHaveBeenCalled();
  });

  it("分类插画静态资源不参与初始化重定向", async () => {
    mocks.setupRequired.mockResolvedValueOnce(true);

    const response = await proxy(
      new NextRequest("http://localhost/expense-categories/food.webp"),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(mocks.setupRequired).not.toHaveBeenCalled();
  });

  it("完成初始化后不改变页面路由", async () => {
    mocks.setupRequired.mockResolvedValueOnce(false);

    const response = await proxy(
      new NextRequest("http://localhost/admin/system"),
    );

    expect(response.headers.get("location")).toBeNull();
  });
});
