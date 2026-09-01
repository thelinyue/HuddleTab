import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { deleteDB } from "idb";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseName } from "../../pwa/indexed-db/database";
import { MutationRepository } from "../../pwa/indexed-db/mutation-repository";

const client = vi.hoisted(() => ({ POST: vi.fn() }));
const csrf = vi.hoisted(() => ({ mutationHeaders: vi.fn().mockResolvedValue({ "X-CSRF-Token": "csrf-token" }) }));

vi.mock("../../api/client", () => ({ apiClient: client }));
vi.mock("../../api/csrf", () => csrf);

import { useCreateExpenseMutation } from "./api";

afterEach(async () => {
  vi.clearAllMocks();
  await deleteDB(databaseName("user-1"));
});

describe("Expense Create Queue", () => {
  it("创建账单先完整持久化为 PENDING 而不在 hook 内直接 POST", async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
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

    expect(client.POST).not.toHaveBeenCalled();
    expect(await new MutationRepository("user-1").get("mutation-1"))
      .toMatchObject({
        activityId: "activity-1",
        payload: expect.objectContaining({ clientMutationId: "mutation-1" }),
        status: "PENDING",
      });
  });
});
