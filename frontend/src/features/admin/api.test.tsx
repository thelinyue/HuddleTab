import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { expect, it, vi } from "vitest";
import { queryKeys } from "../../api/query-keys";

const client = vi.hoisted(() => ({ PUT: vi.fn() }));
vi.mock("../../api/client", () => ({ apiClient: client, AUTH_EXPIRED_EVENT: "auth-expired" }));
vi.mock("../../api/csrf", () => ({ mutationHeaders: vi.fn().mockResolvedValue({}) }));

import { useUpdateRegistrationPolicyMutation } from "./api";

it("管理员更新注册策略后同步公开查询缓存", async () => {
  client.PUT.mockResolvedValue({
    data: { data: { policy: "OPEN", version: 2 } },
    response: new Response(null, { status: 200 }),
  });
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.registrationPolicy, "INVITE_ONLY");
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(() => useUpdateRegistrationPolicyMutation("admin-1"), { wrapper });

  await act(async () => {
    await result.current.mutateAsync({ policy: "OPEN", version: 1 });
  });

  expect(queryClient.getQueryData(queryKeys.registrationPolicy)).toBe("OPEN");
});
