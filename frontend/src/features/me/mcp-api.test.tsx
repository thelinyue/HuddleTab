import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ DELETE: vi.fn(), GET: vi.fn(), POST: vi.fn() }));
const csrf = vi.hoisted(() => ({
  mutationHeaders: vi.fn().mockResolvedValue({ "X-CSRF-Token": "csrf-token" }),
}));

vi.mock("../../api/client", () => ({ apiClient: client }));
vi.mock("../../api/csrf", () => csrf);

import {
  useCreateMcpTokenMutation,
  useMcpTokensQuery,
  useRevokeMcpTokenMutation,
} from "./mcp-api";

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

afterEach(() => {
  vi.clearAllMocks();
  csrf.mutationHeaders.mockResolvedValue({ "X-CSRF-Token": "csrf-token" });
});

describe("MCP token adapter", () => {
  it("读取令牌列表并使用当前用户 query key", async () => {
    client.GET.mockResolvedValue({
      data: { data: [{
        tokenId: "token-1",
        name: "桌面客户端",
        tokenPrefix: "ht_mcp_abc",
        scope: "READ",
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: "2026-09-21T03:00:00Z",
      }] },
      response: new Response(null, { status: 200 }),
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMcpTokensQuery("user-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(client.GET).toHaveBeenCalledWith("/api/me/mcp-tokens");
  });

  it("创建令牌后暴露 secret，并接受撤销接口的 204", async () => {
    client.POST.mockResolvedValue({
      data: { data: {
        tokenId: "token-1",
        name: "桌面客户端",
        tokenPrefix: "ht_mcp_abc",
        scope: "EXPENSES_CREATE",
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: "2026-09-21T03:00:00Z",
        secret: "ht_mcp_secret",
      } },
      response: new Response(null, { status: 200 }),
    });
    client.DELETE.mockResolvedValue({ response: new Response(null, { status: 204 }) });
    const { wrapper } = setup();
    const create = renderHook(() => useCreateMcpTokenMutation("user-1"), { wrapper });
    const revoke = renderHook(() => useRevokeMcpTokenMutation("user-1"), { wrapper });

    let created: { secret: string } | undefined;
    await act(async () => {
      created = await create.result.current.mutateAsync({
        name: "桌面客户端",
        scope: "EXPENSES_CREATE",
        expiresAt: null,
      });
    });
    expect(created?.secret).toBe("ht_mcp_secret");

    await act(async () => {
      await revoke.result.current.mutateAsync("token-1");
    });
    await waitFor(() => expect(revoke.result.current.isSuccess).toBe(true));
    expect(client.DELETE).toHaveBeenCalledWith("/api/me/mcp-tokens/{token_id}", {
      params: { path: { token_id: "token-1" } },
      headers: { "X-CSRF-Token": "csrf-token" },
    });
  });
});
