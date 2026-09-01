import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { deleteDB } from "idb";
import { type PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { queryKeys } from "../../api/query-keys";
import { databaseName } from "../../pwa/indexed-db/database";
import { MutationRepository } from "../../pwa/indexed-db/mutation-repository";
import { expensePayload } from "../../pwa/indexed-db/test-fixtures";

const client = vi.hoisted(() => ({ POST: vi.fn() }));
const csrf = vi.hoisted(() => ({
  mutationHeaders: vi.fn().mockResolvedValue({ "X-CSRF-Token": "csrf-token" }),
}));

vi.mock("../../api/client", () => ({ apiClient: client }));
vi.mock("../../api/csrf", () => csrf);

import { expenseQueueFor } from "./expense-queue";
import { ExpenseQueueSync } from "./expense-queue-sync";

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  await deleteDB(databaseName("user-sync"));
});

it("挂载后新入队会前台同步并刷新全部权威账务查询", async () => {
  client.POST.mockResolvedValue({
    data: {
      data: {
        expense: { expenseId: "expense-1" },
        idempotentReplay: false,
        payments: [],
        shares: [],
      },
    },
    response: new Response(null, { status: 201 }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const authoritativeKeys = [
    queryKeys.expenses("user-sync", "activity-1"),
    queryKeys.ledger("user-sync", "activity-1"),
    queryKeys.recommendations("user-sync", "activity-1"),
    queryKeys.settlements("user-sync", "activity-1"),
    queryKeys.activityDetail("user-sync", "activity-1"),
  ];
  for (const key of authoritativeKeys) queryClient.setQueryData(key, {});
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<ExpenseQueueSync userId="user-sync" />, { wrapper });

  await act(async () => {
    await expenseQueueFor("user-sync").enqueue("activity-1", {
      ...expensePayload,
      clientMutationId: "mutation-sync",
    });
  });

  await waitFor(async () => {
    expect(await new MutationRepository("user-sync").get("mutation-sync"))
      .toMatchObject({ status: "SYNCED", serverExpenseId: "expense-1" });
  });
  expect(client.POST).toHaveBeenCalledWith(
    "/api/activities/{activity_id}/expenses",
    {
      body: expect.objectContaining({ clientMutationId: "mutation-sync" }),
      headers: { "X-CSRF-Token": "csrf-token" },
      params: { path: { activity_id: "activity-1" } },
    },
  );
  for (const key of authoritativeKeys) {
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  }
});
