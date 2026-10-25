import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ DELETE: vi.fn() }));
vi.mock("../../api/client", () => ({ apiClient: client }));
vi.mock("../../api/csrf", () => ({ mutationHeaders: async () => ({ "X-CSRF-Token": "csrf-token" }) }));

import { detachPushForLogout } from "./api";

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("退出登录的推送清理", () => {
  it("没有 Service Worker 注册且 ready 永不完成时仍可退出", async () => {
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration, ready: new Promise(() => {}) } });
    await detachPushForLogout();
    expect(getRegistration).toHaveBeenCalledExactlyOnceWith();
    expect(client.DELETE).not.toHaveBeenCalled();
  });

  it("已有注册但不支持推送时不阻止退出", async () => {
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({}) } });
    await expect(detachPushForLogout()).resolves.toBeUndefined();
    expect(client.DELETE).not.toHaveBeenCalled();
  });

  it("退出前仍解除已有订阅的服务端关联", async () => {
    const getSubscription = vi.fn().mockResolvedValue({ endpoint: "https://push.example.test/device" });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription } }) } });
    client.DELETE.mockResolvedValue({ data: { data: {} }, response: new Response(null, { status: 200 }) });
    await detachPushForLogout();
    expect(client.DELETE).toHaveBeenCalledExactlyOnceWith("/api/me/push-subscriptions", {
      params: { header: { "x-csrf-token": "csrf-token" } }, body: { endpoint: "https://push.example.test/device" },
    });
  });

  it("读取注册失败时仍继续退出", async () => {
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn().mockRejectedValue(new Error("读取失败")) } });
    await expect(detachPushForLogout()).resolves.toBeUndefined();
    expect(client.DELETE).not.toHaveBeenCalled();
  });
});
