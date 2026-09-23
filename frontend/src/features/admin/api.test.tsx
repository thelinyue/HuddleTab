import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { queryKeys } from "../../api/query-keys";

const client = vi.hoisted(() => ({ PUT: vi.fn(), PATCH: vi.fn() }));
vi.mock("../../api/client", () => ({ apiClient: client, AUTH_EXPIRED_EVENT: "auth-expired" }));
vi.mock("../../api/csrf", () => ({ mutationHeaders: vi.fn().mockResolvedValue({}) }));

import { useResetAdminPasswordMutation, useUpdateAdminRoleMutation, useUpdateAdminUserStatusMutation, useUpdateRegistrationPolicyMutation } from "./api";

afterEach(() => vi.resetAllMocks());

it.each(["disable", "revoke", "password"])("自身账号 %s 成功后立即清理认证且不再刷新管理查询", async (action) => {
  client.PATCH.mockResolvedValue({ data: { data: { changed: true } }, response: new Response(null, { status: 200 }) });
  client.PUT.mockResolvedValue({ data: { data: { changed: true } }, response: new Response(null, { status: 200 }) });
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const expired = vi.fn();
  window.addEventListener("auth-expired", expired);
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(() => ({ status: useUpdateAdminUserStatusMutation("me"), role: useUpdateAdminRoleMutation("me"), password: useResetAdminPasswordMutation("me") }), { wrapper });
  try {
    await act(async () => {
      if (action === "disable") await result.current.status.mutateAsync({ userId: "me", disabled: true });
      else if (action === "revoke") await result.current.role.mutateAsync({ userId: "me", granted: false });
      else await result.current.password.mutateAsync({ userId: "me", newPassword: "valid-password" });
    });
    expect(expired).toHaveBeenCalledOnce();
    expect(invalidate).not.toHaveBeenCalled();
  } finally { window.removeEventListener("auth-expired", expired); queryClient.clear(); }
});

it("管理写入失败不改缓存，成功后同步账号状态和角色", async () => {
  const queryClient = new QueryClient();
  const original = [{ id: "other", username: "other", displayName: "其他用户", avatarPreset: 1, disabled: false, isSystemAdmin: false }];
  queryClient.setQueryData(queryKeys.adminUsers("me"), original);
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(() => ({ status: useUpdateAdminUserStatusMutation("me"), role: useUpdateAdminRoleMutation("me") }), { wrapper });
  client.PATCH.mockRejectedValueOnce(new Error("拒绝操作"));
  await act(async () => { await expect(result.current.status.mutateAsync({ userId: "other", disabled: true })).rejects.toThrow("拒绝操作"); });
  expect(queryClient.getQueryData(queryKeys.adminUsers("me"))).toEqual(original);
  client.PATCH.mockResolvedValue({ data: { data: { changed: true } }, response: new Response(null, { status: 200 }) });
  await act(async () => {
    await result.current.status.mutateAsync({ userId: "other", disabled: true });
    await result.current.role.mutateAsync({ userId: "other", granted: true });
  });
  expect(queryClient.getQueryData(queryKeys.adminUsers("me"))).toEqual([{ ...original[0], disabled: true, isSystemAdmin: true }]);
  queryClient.clear();
});

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
