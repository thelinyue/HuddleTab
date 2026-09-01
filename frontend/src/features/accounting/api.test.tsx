import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../api/query-keys";

const client = vi.hoisted(() => ({ POST: vi.fn() }));
const csrf = vi.hoisted(() => ({ mutationHeaders: vi.fn().mockResolvedValue({ "X-CSRF-Token": "csrf-token" }) }));

vi.mock("../../api/client", () => ({ apiClient: client }));
vi.mock("../../api/csrf", () => csrf);

import { useCreateExpenseMutation } from "./api";

afterEach(() => vi.clearAllMocks());

describe("Accounting mutation query invalidation", () => {
  it("创建账单后刷新当前 Activity detail 以取得账务锁能力", async () => {
    client.POST.mockResolvedValue({
      data: { data: {} },
      response: new Response(null, { status: 201 }),
    });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useCreateExpenseMutation("user-1", "activity-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        category: "FOOD",
        clientMutationId: "mutation-1",
        exchangeRate: "1",
        exchangeRateKind: "IDENTITY",
        note: null,
        occurredAt: "2026-09-01T08:00:00Z",
        originalAmountMinor: "1000",
        originalCurrency: "CNY",
        payments: [{ amountMinor: "1000", memberId: "member-1" }],
        split: { members: ["member-1"], mode: "EQUAL" },
        title: "午餐",
      });
    });

    expect(invalidate.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: queryKeys.expenses("user-1", "activity-1") },
      { queryKey: queryKeys.ledger("user-1", "activity-1") },
      { queryKey: queryKeys.recommendations("user-1", "activity-1") },
      { queryKey: queryKeys.settlements("user-1", "activity-1") },
      { queryKey: queryKeys.activityDetail("user-1", "activity-1") },
    ]);
  });
});
