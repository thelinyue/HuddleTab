// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { deleteDB } from "idb";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { databaseName } from "../../pwa/indexed-db/database";
import { SnapshotRepository } from "../../pwa/indexed-db/snapshot-repository";
import { useActivitySnapshotQuery } from "./offline-workspace";

const snapshot = {
  activity: { activityId: "activity-1" },
  expenses: [],
  ledger: { balances: [], baseCurrency: "CNY", revision: "3" },
  members: [],
  recommendations: { baseCurrency: "CNY", recommendations: [], revision: "3" },
  revision: "3",
  settlements: [],
};

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteDB(databaseName("user-1"));
});

it("断网时只从当前用户 Snapshot 恢复完整活动工作台", async () => {
  await new SnapshotRepository("user-1").replace("activity-1", {
    etag: 'W/"3"',
    snapshot: snapshot as never,
  });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => useActivitySnapshotQuery("user-1", "activity-1"),
    { wrapper },
  );

  await waitFor(() => expect(result.current.data?.fromCache).toBe(true));
  expect(result.current.data?.snapshot).toEqual(snapshot);
});

it("断网且没有 Snapshot 时返回明确中文错误", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => useActivitySnapshotQuery("user-1", "activity-1"),
    { wrapper },
  );

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toHaveProperty("message", "此活动尚未缓存，无法离线查看。");
});
