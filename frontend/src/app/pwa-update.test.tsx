// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { deleteDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { databaseName, withUserDatabase } from "../pwa/indexed-db/database";

const swState = vi.hoisted(() => ({
  needRefresh: true,
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [swState.needRefresh, swState.setNeedRefresh],
    updateServiceWorker: swState.updateServiceWorker,
  }),
}));

vi.mock("../features/auth/api", () => ({
  useSessionQuery: () => ({ data: { userId: "user-1" } }),
}));

import { PwaUpdatePrompt } from "./pwa-update";

afterEach(async () => {
  cleanup();
  swState.needRefresh = true;
  swState.setNeedRefresh.mockClear();
  swState.updateServiceWorker.mockClear();
  await deleteDB(databaseName("user-1"));
});

describe("PWA 更新提示", () => {
  it("存在未完成账单时沿用 v0.0.2 文案并阻止立即更新", async () => {
    await withUserDatabase("user-1", (database) => database.put("pending_mutations", {
      id: "mutation-1",
      userId: "user-1",
      activityId: "activity-1",
      kind: "CREATE_EXPENSE",
      payload: {} as never,
      status: "REJECTED",
      attemptCount: 1,
      nextAttemptAt: 0,
      createdAt: 1,
      updatedAt: 1,
    }));

    render(<PwaUpdatePrompt />);
    expect(await screen.findByText("有新版本可用，完成同步后更新")).toBeInTheDocument();
    const refresh = screen.getByRole("button", { name: /刷新/ });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
  });

  it("全部本地记录已同步时允许刷新并在点击前再次检查", async () => {
    await withUserDatabase("user-1", (database) => database.put("pending_mutations", {
      id: "mutation-1",
      userId: "user-1",
      activityId: "activity-1",
      kind: "CREATE_EXPENSE",
      payload: {} as never,
      status: "SYNCED",
      attemptCount: 1,
      nextAttemptAt: 0,
      serverExpenseId: "expense-1",
      createdAt: 1,
      updatedAt: 1,
    }));

    render(<PwaUpdatePrompt />);
    const refresh = await screen.findByRole("button", { name: /刷新/ });
    await waitFor(() => expect(refresh).not.toBeDisabled());
    fireEvent.click(refresh);
    await waitFor(() => expect(swState.updateServiceWorker).toHaveBeenCalledWith(true));
  });
});
