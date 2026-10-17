// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { setImmediate as nextTask } from "node:timers/promises";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as databaseModule from "../pwa/indexed-db/database";
import { databaseName, withUserDatabase } from "../pwa/indexed-db/database";
import type { MutationStatus } from "../pwa/indexed-db/schema";
import { PwaUpdateSafetyProvider, usePwaUpdateBlock } from "./pwa-update-safety";

const swState = vi.hoisted(() => ({
  needRefresh: true,
  updateServiceWorker: vi.fn().mockResolvedValue(undefined),
}));
const sessionState = vi.hoisted(() => ({
  data: { userId: "user-1" } as { userId: string } | null,
  isPending: false,
  isError: false,
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [swState.needRefresh],
    updateServiceWorker: swState.updateServiceWorker,
  }),
}));
vi.mock("../features/auth/api", () => ({ useSessionQuery: () => sessionState }));

import { PwaUpdatePrompt } from "./pwa-update";

const readyMessage = "新版可用，稍后自动更新";
const syncMessage = "同步完成后自动更新";
const editingMessage = "编辑完成后自动更新";
const updateError = "更新未完成，请重试";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function advance(milliseconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

/** 等待真实 IndexedDB 任务和 React 提交，保持业务倒计时完全由测试控制。 */
async function settle(assertion: () => void) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => { await nextTask(); });
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 99) throw error;
    }
  }
}

async function expectMessage(message: string) {
  await settle(() => expect(screen.getByText(message)).toBeInTheDocument());
}

function openConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: "更新" }));
  return screen.getByRole("alertdialog", { name: "更新" });
}

function forceUpdate() {
  const dialog = openConfirmation();
  fireEvent.click(within(dialog).getByRole("button", { name: "更新" }));
}

async function saveMutation(status: MutationStatus, userId = "user-1") {
  return withUserDatabase(userId, (database) => database.put("pending_mutations", {
    id: "mutation-1", userId, activityId: "activity-1", kind: "CREATE_EXPENSE",
    payload: {} as never, status, attemptCount: 1, nextAttemptAt: 0,
    createdAt: 1, updatedAt: 1,
  }));
}

async function saveAttachment(status: MutationStatus) {
  return withUserDatabase("user-1", (database) => database.put("pending_attachments", {
    id: "attachment-1", userId: "user-1", activityId: "activity-1", mutationId: "mutation-1",
    clientAttachmentId: "client-attachment-1", fileName: "receipt.png", mimeType: "image/png",
    blob: new Uint8Array([1, 2, 3]).buffer, status, attemptCount: 1, nextAttemptAt: 0,
    createdAt: 1, updatedAt: 1,
  }));
}

beforeEach(() => {
  // IndexedDB 的异步任务继续使用真实事件循环，只推进业务等待和激活超时。
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: new EventTarget() });
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
  swState.needRefresh = true;
  swState.updateServiceWorker.mockReset().mockResolvedValue(undefined);
  sessionState.data = { userId: "user-1" };
  sessionState.isPending = false;
  sessionState.isError = false;
  await Promise.all([deleteDB(databaseName("user-1")), deleteDB(databaseName("user-2"))]);
});

describe("PWA 更新提示", () => {
  it("无新版时不显示入口", () => {
    swState.needRefresh = false;
    render(<PwaUpdatePrompt />);
    expect(screen.queryByRole("button", { name: "更新" })).not.toBeInTheDocument();
  });

  it("编辑锁存在时更新按钮仍可操作，确认后直接更新", () => {
    render(<LockedPrompt first={true} second={true} />);
    expect(screen.getByRole("button", { name: "更新" })).toBeEnabled();
    const dialog = openConfirmation();
    expect(dialog).toHaveTextContent("未保存内容将丢失");
    expect(dialog).toHaveTextContent("离线账单和附件保留");
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole("button", { name: "更新" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(swState.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each(["PENDING", "SYNCING", "RETRYABLE", "REJECTED"] as MutationStatus[])(
    "%s 账单和附件阻止自动更新，但允许手动更新并保留原记录",
    async (status) => {
      await saveMutation(status);
      await saveAttachment(status);
      const readRecords = () => withUserDatabase("user-1", async (database) => ({
        mutations: await database.getAll("pending_mutations"),
        attachments: await database.getAll("pending_attachments"),
      }));
      const before = await readRecords();
      render(<PwaUpdatePrompt />);
      await expectMessage(syncMessage);
      await advance(20_000);
      expect(swState.updateServiceWorker).not.toHaveBeenCalled();
      forceUpdate();
      expect(swState.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true);
      expect(await readRecords()).toEqual(before);
    },
  );

  it.each(["isPending", "isError"] as const)("Session %s 不阻止手动更新", (flag) => {
    sessionState[flag] = true;
    render(<PwaUpdatePrompt />);
    expect(screen.getByRole("button", { name: "更新" })).toBeEnabled();
    forceUpdate();
    expect(swState.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("本地检查失败仍允许手动更新", async () => {
    vi.spyOn(databaseModule, "openHuddleTabDb").mockRejectedValue(new Error("database unavailable"));
    render(<PwaUpdatePrompt />);
    await expectMessage("无法确认同步状态");
    forceUpdate();
    expect(swState.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("本地检查卡住时可立即手动更新，旧检查结果不能覆盖更新状态", async () => {
    await saveMutation("REJECTED");
    const pending = deferred<Awaited<ReturnType<typeof databaseModule.openHuddleTabDb>>>();
    const actualDatabase = await databaseModule.openHuddleTabDb("user-1");
    const closed = vi.spyOn(actualDatabase, "close");
    vi.spyOn(databaseModule, "openHuddleTabDb").mockReturnValueOnce(pending.promise);
    render(<PwaUpdatePrompt />);
    expect(screen.getByText("检查中…")).toBeInTheDocument();
    forceUpdate();
    expect(swState.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true);
    await act(async () => { pending.resolve(actualDatabase); });
    await settle(() => expect(closed).toHaveBeenCalled());
    expect(screen.getByText("更新中…")).toBeInTheDocument();
    expect(screen.queryByText(syncMessage)).not.toBeInTheDocument();
  });

  it("安全后等待完整 10 秒，重复安全事件不延后更新", async () => {
    await saveMutation("SYNCED");
    await saveAttachment("SYNCED");
    render(<PwaUpdatePrompt />);
    await expectMessage(readyMessage);
    await advance(5_000);
    fireEvent(window, new Event("online"));
    await expectMessage(readyMessage);
    await advance(4_999);
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
    await advance(1);
    await settle(() => expect(swState.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true));
    fireEvent(window, new Event("huddletab:expense-queue-changed"));
    expect(swState.updateServiceWorker).toHaveBeenCalledTimes(1);
  });

  it("弹窗暂停自动更新，取消后重新等待 10 秒", async () => {
    render(<PwaUpdatePrompt />);
    await expectMessage(readyMessage);
    await advance(6_000);
    const dialog = openConfirmation();
    await advance(20_000);
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await expectMessage(readyMessage);
    await advance(9_999);
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
    await advance(1);
    await settle(() => expect(swState.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true));
  });

  it("等待期间新增未同步记录，即使没有事件也会在激活前发现", async () => {
    render(<PwaUpdatePrompt />);
    await expectMessage(readyMessage);
    await saveMutation("PENDING");
    await advance(10_000);
    await expectMessage(syncMessage);
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
    await saveMutation("SYNCED");
    fireEvent(window, new Event("huddletab:expense-queue-changed"));
    await expectMessage(readyMessage);
    await advance(10_000);
    await settle(() => expect(swState.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true));
  });

  it("嵌套编辑锁取消定时，全部释放后重新等待 10 秒", async () => {
    const view = render(<LockedPrompt first={false} second={false} />);
    await expectMessage(readyMessage);
    await advance(6_000);
    view.rerender(<LockedPrompt first={true} second={true} />);
    await expectMessage(editingMessage);
    await advance(20_000);
    view.rerender(<LockedPrompt first={true} second={false} />);
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
    view.rerender(<LockedPrompt first={false} second={false} />);
    await expectMessage(readyMessage);
    await advance(9_999);
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
    await advance(1);
    await settle(() => expect(swState.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true));
  });

  it("页面隐藏取消定时，回到页面后重新等待", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    render(<PwaUpdatePrompt />);
    await expectMessage(readyMessage);
    await advance(6_000);
    visibility.mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    await advance(20_000);
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    await expectMessage(readyMessage);
    await advance(10_000);
    await settle(() => expect(swState.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true));
  });

  it("用户切换取消旧定时并检查新用户队列", async () => {
    await saveMutation("REJECTED", "user-2");
    const view = render(<PwaUpdatePrompt />);
    await expectMessage(readyMessage);
    await advance(6_000);
    sessionState.data = { userId: "user-2" };
    view.rerender(<PwaUpdatePrompt />);
    await expectMessage(syncMessage);
    await advance(20_000);
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
  });

  it("卸载取消自动更新", async () => {
    const view = render(<PwaUpdatePrompt />);
    await expectMessage(readyMessage);
    view.unmount();
    await advance(20_000);
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
  });

  it("激活失败后恢复更新按钮并支持手动重试", async () => {
    swState.updateServiceWorker.mockRejectedValueOnce(new Error("activate failed"));
    render(<LockedPrompt first={true} second={false} />);
    forceUpdate();
    await expectMessage(updateError);
    expect(screen.getByRole("button", { name: "更新" })).toBeEnabled();
    forceUpdate();
    expect(swState.updateServiceWorker).toHaveBeenCalledTimes(2);
  });

  it("激活超时后可重试，旧请求的迟到失败不能覆盖新尝试", async () => {
    const pending = deferred<void>();
    swState.updateServiceWorker.mockReturnValueOnce(pending.promise);
    render(<LockedPrompt first={true} second={false} />);
    forceUpdate();
    await advance(9_999);
    expect(screen.getByText("更新中…")).toBeInTheDocument();
    await advance(1);
    expect(screen.getByText(updateError)).toBeInTheDocument();
    forceUpdate();
    await act(async () => { pending.reject(new Error("late activation failure")); });
    expect(screen.getByText("更新中…")).toBeInTheDocument();
    expect(swState.updateServiceWorker).toHaveBeenCalledTimes(2);
  });

  it("请求返回不代表切换成功，实际 controllerchange 才取消超时", async () => {
    render(<LockedPrompt first={true} second={false} />);
    forceUpdate();
    await advance(5_000);
    expect(screen.getByText("更新中…")).toBeInTheDocument();
    act(() => { navigator.serviceWorker.dispatchEvent(new Event("controllerchange")); });
    await advance(20_000);
    expect(screen.queryByText(updateError)).not.toBeInTheDocument();
    expect(swState.updateServiceWorker).toHaveBeenCalledTimes(1);
  });

  it("自动激活失败后通过联网事件重新等待并重试", async () => {
    swState.updateServiceWorker.mockRejectedValueOnce(new Error("activate failed"));
    render(<PwaUpdatePrompt />);
    await expectMessage(readyMessage);
    await advance(10_000);
    await expectMessage(updateError);
    fireEvent(window, new Event("online"));
    await expectMessage(readyMessage);
    await advance(10_000);
    await settle(() => expect(swState.updateServiceWorker).toHaveBeenCalledTimes(2));
  });
});
