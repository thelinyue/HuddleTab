import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ DELETE: vi.fn(), GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() }));
const csrf = vi.hoisted(() => ({ mutationHeaders: vi.fn().mockResolvedValue({ "X-CSRF-Token": "csrf-token" }) }));

vi.mock("../../api/client", () => ({ apiClient: client }));
vi.mock("../../api/csrf", () => csrf);

import { queryKeys } from "../../api/query-keys";
import * as activityApi from "./api";
import { invitationRequest } from "./api";

const activity = {
  activityId: "activity-1",
  allowedLifecycleActions: ["END"],
  baseCurrency: "CNY",
  canDelete: true,
  canRestore: false,
  currentMemberId: "member-owner",
  currentMemberRole: "OWNER",
  deletedAt: null,
  endDate: null,
  fieldPermissions: { baseCurrency: true, endDate: true, location: true, name: true, startDate: true },
  hasAccountingRecords: false,
  location: "杭州",
  name: "测试活动",
  ownerMemberId: "member-owner",
  purgeAfter: null,
  revision: "1",
  startDate: "2026-09-01",
  status: "ACTIVE",
  version: "7",
};

function successful(data: unknown = activity) {
  return { data: { data }, response: new Response(null, { status: 200 }) };
}

function setupQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

function exportedHook(name: string): (...args: never[]) => unknown {
  const hook = Reflect.get(activityApi, name);
  expect(hook, `${name} 应由 Activity adapter 导出`).toBeTypeOf("function");
  return hook as (...args: never[]) => unknown;
}

afterEach(() => {
  vi.clearAllMocks();
  csrf.mutationHeaders.mockResolvedValue({ "X-CSRF-Token": "csrf-token" });
});

describe("invitationRequest", () => {
  it("将链接邀请映射为不限次数的 LINK 请求", () => {
    expect(invitationRequest({ mode: "link" })).toEqual({ kind: "LINK", maxUses: null, targetUsername: null });
  });

  it("将定向邀请映射为指定用户名的一次性 DIRECT 请求", () => {
    expect(invitationRequest({ mode: "direct", targetUsername: "invitee" })).toEqual({
      kind: "DIRECT",
      maxUses: 1,
      targetUsername: "invitee",
    });
  });
});

describe("Activity 查询 adapter", () => {
  it("current、deleted 列表和详情使用互不混淆的查询 key 与精确请求", async () => {
    client.GET
      .mockResolvedValueOnce(successful([activity]))
      .mockResolvedValueOnce(successful([activity]))
      .mockResolvedValueOnce(successful());
    const { wrapper } = setupQueryClient();
    const useDeletedActivitiesQuery = exportedHook("useDeletedActivitiesQuery") as (userId: string) => ReturnType<typeof activityApi.useActivitiesQuery>;

    const current = renderHook(() => activityApi.useActivitiesQuery("user-1"), { wrapper });
    const deleted = renderHook(() => useDeletedActivitiesQuery("user-1"), { wrapper });
    const detail = renderHook(() => activityApi.useActivityQuery("user-1", "activity-1"), { wrapper });

    await waitFor(() => {
      expect(current.result.current.isSuccess).toBe(true);
      expect(deleted.result.current.isSuccess).toBe(true);
      expect(detail.result.current.isSuccess).toBe(true);
    });
    expect(Reflect.get(queryKeys, "activitiesCurrent")("user-1")).not.toEqual(Reflect.get(queryKeys, "activitiesDeleted")("user-1"));
    expect(Reflect.get(queryKeys, "activityDetail")("user-1", "activity-1")).not.toEqual(Reflect.get(queryKeys, "activitiesCurrent")("user-1"));
    expect(client.GET).toHaveBeenNthCalledWith(1, "/api/activities", { params: { query: { view: "current" } } });
    expect(client.GET).toHaveBeenNthCalledWith(2, "/api/activities", { params: { query: { view: "deleted" } } });
    expect(client.GET).toHaveBeenNthCalledWith(3, "/api/activities/{activity_id}", {
      params: { path: { activity_id: "activity-1" } },
    });
  });

  it("deleted 查询仅在 Overlay 打开后启用", async () => {
    client.GET.mockResolvedValue(successful([activity]));
    const { wrapper } = setupQueryClient();
    const deleted = renderHook(
      ({ enabled }) => activityApi.useDeletedActivitiesQuery("user-1", enabled),
      { initialProps: { enabled: false }, wrapper },
    );

    await act(async () => undefined);
    expect(client.GET).not.toHaveBeenCalled();

    deleted.rerender({ enabled: true });
    await waitFor(() => expect(deleted.result.current.isSuccess).toBe(true));
    expect(client.GET).toHaveBeenCalledTimes(1);
    expect(client.GET).toHaveBeenCalledWith("/api/activities", {
      params: { query: { view: "deleted" } },
    });
  });
});

describe("Activity mutation adapter", () => {
  it.each([
    { hookName: "useUpdateActivityMutation", clientMethod: "PUT", mutateInput: { name: "新名称", location: null, version: "7" }, path: "/api/activities/{activity_id}", expectedBody: { name: "新名称", location: null, version: "7" }, invalidatesDeleted: false },
    { hookName: "useActivityLifecycleMutation", clientMethod: "POST", mutateInput: { action: "END", version: "7" }, path: "/api/activities/{activity_id}/lifecycle", expectedBody: { action: "END", version: "7" }, invalidatesDeleted: false },
    { hookName: "useDeleteActivityMutation", clientMethod: "DELETE", mutateInput: "7", path: "/api/activities/{activity_id}", expectedBody: { version: "7" }, invalidatesDeleted: true },
    { hookName: "useRestoreActivityMutation", clientMethod: "POST", mutateInput: "7", path: "/api/activities/{activity_id}/restore", expectedBody: { version: "7" }, invalidatesDeleted: true },
  ])("$hookName 发送 generated 请求并精确失效受影响查询", async ({ hookName, clientMethod, mutateInput, path, expectedBody, invalidatesDeleted }) => {
    const response = hookName === "useUpdateActivityMutation"
      ? { data: { data: activity, warnings: [] }, response: new Response(null, { status: 200 }) }
      : successful();
    Reflect.get(client, clientMethod).mockResolvedValue(response);
    const { queryClient, wrapper } = setupQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const hook = exportedHook(hookName) as (userId: string, activityId: string) => { mutateAsync: (input: unknown) => Promise<unknown> };
    const { result } = renderHook(() => hook("user-1", "activity-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(mutateInput);
    });

    expect(Reflect.get(client, clientMethod)).toHaveBeenCalledWith(path, {
      body: expectedBody,
      headers: { "X-CSRF-Token": "csrf-token" },
      params: { path: { activity_id: "activity-1" } },
    });
    const expectedInvalidations = [
      { queryKey: Reflect.get(queryKeys, "activityDetail")("user-1", "activity-1") },
      { queryKey: Reflect.get(queryKeys, "activitiesCurrent")("user-1") },
      ...(invalidatesDeleted
        ? [{ queryKey: Reflect.get(queryKeys, "activitiesDeleted")("user-1") }]
        : []),
    ];
    expect(invalidate.mock.calls.map(([options]) => options)).toEqual(expectedInvalidations);
  });

  it("update 保留 generated envelope 的 warnings", async () => {
    const envelope = { data: activity, warnings: ["EXPENSE_BEFORE_ACTIVITY_START"] };
    client.PUT.mockResolvedValue({
      data: envelope,
      response: new Response(null, { status: 200 }),
    });
    const { wrapper } = setupQueryClient();
    const { result } = renderHook(
      () => activityApi.useUpdateActivityMutation("user-1", "activity-1"),
      { wrapper },
    );

    let response: unknown;
    await act(async () => {
      response = await result.current.mutateAsync({ name: "新名称", version: "7" });
    });

    expect(response).toEqual(envelope);
  });
});
