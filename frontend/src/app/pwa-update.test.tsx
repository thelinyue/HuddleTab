// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { deleteDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { databaseName, withUserDatabase } from "../pwa/indexed-db/database";
import { PwaUpdateSafetyProvider, usePwaUpdateBlock } from "./pwa-update-safety";

const swState = vi.hoisted(() => ({
  needRefresh: true,
  updateServiceWorker: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [swState.needRefresh],
    updateServiceWorker: swState.updateServiceWorker,
  }),
}));

vi.mock("../features/auth/api", () => ({
  useSessionQuery: () => ({ data: { userId: "user-1" }, isPending: false }),
}));

import { PwaUpdatePrompt } from "./pwa-update";

function UpdateLock({ active }: { active: boolean }) {
  usePwaUpdateBlock(active);
  return null;
}

function LockedPrompt({ first, second }: { first: boolean; second: boolean }) {
  return (
    <PwaUpdateSafetyProvider>
      <UpdateLock active={first} />
      <UpdateLock active={second} />
      <PwaUpdatePrompt />
    </PwaUpdateSafetyProvider>
  );
}

afterEach(async () => {
  cleanup();
  swState.needRefresh = true;
  swState.updateServiceWorker.mockReset().mockResolvedValue(undefined);
  await deleteDB(databaseName("user-1"));
});

describe("PWA 更新提示", () => {
  it("存在未完成账单时只显示单行状态并阻止自动更新", async () => {
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

    expect(await screen.findByText("有新版本可用，完成同步后将自动更新。")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
  });

  it("全部本地记录已同步时自动激活且只调用一次", async () => {
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
    await waitFor(() => expect(swState.updateServiceWorker).toHaveBeenCalledWith(true));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("huddletab:expense-queue-changed"));
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(swState.updateServiceWorker).toHaveBeenCalledTimes(1));
  });

  it("队列从失败恢复同步后通过既有事件继续自动更新", async () => {
    await withUserDatabase("user-1", (database) => database.put("pending_mutations", {
      id: "mutation-1",
      userId: "user-1",
      activityId: "activity-1",
      kind: "CREATE_EXPENSE",
      payload: {} as never,
      status: "RETRYABLE",
      attemptCount: 1,
      nextAttemptAt: 0,
      createdAt: 1,
      updatedAt: 1,
    }));

    render(<PwaUpdatePrompt />);
    expect(await screen.findByText("有新版本可用，完成同步后将自动更新。")).toBeInTheDocument();
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();

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
      updatedAt: 2,
    }));
    window.dispatchEvent(new Event("huddletab:expense-queue-changed"));
    await waitFor(() => expect(swState.updateServiceWorker).toHaveBeenCalledWith(true));
  });

  it("嵌套编辑锁全部释放后才继续自动更新", async () => {
    const view = render(<LockedPrompt first={true} second={true} />);
    expect(await screen.findByText("有新版本可用，完成同步后将自动更新。")).toBeInTheDocument();
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();

    view.rerender(<LockedPrompt first={true} second={false} />);
    await waitFor(() => expect(swState.updateServiceWorker).not.toHaveBeenCalled());
    view.rerender(<LockedPrompt first={false} second={false} />);
    await waitFor(() => expect(swState.updateServiceWorker).toHaveBeenCalledWith(true));
  });

  it("激活失败后通过后续联网事件自动重试", async () => {
    swState.updateServiceWorker.mockRejectedValueOnce(new Error("activate failed"));
    render(<PwaUpdatePrompt />);
    await waitFor(() => expect(swState.updateServiceWorker).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("更新暂未完成，将在稍后自动重试。")).toBeInTheDocument();

    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(swState.updateServiceWorker).toHaveBeenCalledTimes(2));
  });
});
