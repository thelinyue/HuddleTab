// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { deleteDB } from "idb";

vi.mock("@/features/expenses/api", () => ({
  createExpense: vi.fn(),
}));

import { MutationRepository } from "@/pwa/indexed-db/mutation-repository";
import { SyncTriggers } from "@/pwa/sync-queue/sync-triggers";

const userId = "sync-ui-user";

afterEach(async () => {
  cleanup();
  await deleteDB(`huddletab:${userId}`);
  vi.unstubAllGlobals();
});

function setOffline() {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: false,
  });
}

test("没有可重试失败时不显示重试同步按钮", async () => {
  setOffline();
  render(<SyncTriggers userId={userId} />);

  await waitFor(() => {
    expect(
      screen.queryByRole("button", { name: "重试同步" }),
    ).not.toBeInTheDocument();
  });
});

test("存在账单重试失败时显示同步状态条", async () => {
  setOffline();
  const queue = new MutationRepository(userId, () => 0);
  await queue.add({
    id: "mutation-1",
    activityId: "activity-1",
    kind: "CREATE_EXPENSE",
    payload: {} as never,
  });
  await queue.markRetryable("mutation-1", 1_000, {
    code: "SYNC_FAILED",
    message: "网络连接失败。",
  });

  render(<SyncTriggers userId={userId} />);

  expect(await screen.findByRole("button", { name: "重试同步" })).toBeVisible();
  expect(screen.getByRole("alert", { name: "同步失败" })).toHaveTextContent(
    "存在待重试的同步任务。",
  );
});
