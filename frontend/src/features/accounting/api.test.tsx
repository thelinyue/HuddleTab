import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { deleteDB } from "idb";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseName } from "../../pwa/indexed-db/database";
import { AttachmentRepository } from "../../pwa/indexed-db/attachment-repository";
import { MutationRepository } from "../../pwa/indexed-db/mutation-repository";
import type { PendingAttachment } from "../../pwa/indexed-db/schema";

const client = vi.hoisted(() => ({ DELETE: vi.fn(), POST: vi.fn() }));
const csrf = vi.hoisted(() => ({ mutationHeaders: vi.fn().mockResolvedValue({ "X-CSRF-Token": "csrf-token" }) }));

vi.mock("../../api/client", () => ({ apiClient: client }));
vi.mock("../../api/csrf", () => csrf);

import {
  deleteExpenseAttachment,
  uploadExpenseAttachment,
  useCreateExpenseMutation,
} from "./api";

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
      await result.current.mutateAsync({ input: {
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
      }, files: [] });
    });

    expect(client.POST).not.toHaveBeenCalled();
    expect(await new MutationRepository("user-1").get("mutation-1"))
      .toMatchObject({
        activityId: "activity-1",
        payload: expect.objectContaining({ clientMutationId: "mutation-1" }),
        status: "PENDING",
      });
  });

  it("创建 mutation 把原始 File[] 原样交给本地原子队列", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(
      () => useCreateExpenseMutation("user-1", "activity-1"),
      { wrapper },
    );
    const file = new File(["receipt"], "receipt.png", {
      type: "image/png",
    });

    await act(async () => {
      await result.current.mutateAsync({
        input: {
          category: "FOOD",
          clientMutationId: "mutation-with-file",
          exchangeRate: "1",
          exchangeRateKind: "IDENTITY",
          note: "保留表单",
          occurredAt: "2026-09-01T08:00:00Z",
          originalAmountMinor: "1000",
          originalCurrency: "CNY",
          payments: [{ amountMinor: "1000", memberId: "member-1" }],
          split: { members: ["member-1"], mode: "EQUAL" },
          title: "午餐",
        },
        files: [file],
      });
    });

    const [saved] = await new AttachmentRepository("user-1")
      .listByMutation("mutation-with-file");
    expect(saved).toMatchObject({
      fileName: "receipt.png",
      mimeType: "image/png",
      mutationId: "mutation-with-file",
      status: "PENDING",
    });
  });

  it("附件 adapter 发送原始文件、稳定 client ID 与 CSRF", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], {
      type: "image/png",
    });
    const attachment: PendingAttachment = {
      id: "local-attachment-1",
      userId: "user-1",
      activityId: "activity-1",
      mutationId: "mutation-1",
      clientAttachmentId: "client-attachment-1",
      fileName: "receipt.png",
      mimeType: "image/png",
      blob,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const metadata = {
      byteSize: "456",
      createdAt: "2026-09-02T01:00:00Z",
      height: 20,
      id: "server-attachment-1",
      mimeType: "image/webp",
      width: 30,
    };
    client.POST.mockResolvedValue({
      data: { data: metadata },
      response: new Response(null, { status: 201 }),
    });

    const result = await uploadExpenseAttachment(
      "activity-1",
      "expense-1",
      attachment,
    );

    const [, options] = client.POST.mock.calls[0];
    const body = options.bodySerializer() as FormData;
    const sentFile = body.get("file") as File;
    expect(new Uint8Array(await sentFile.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(sentFile.name).toBe("receipt.png");
    expect(body.get("clientAttachmentId")).toBe("client-attachment-1");
    expect(options).toMatchObject({
      params: {
        header: { "x-csrf-token": "csrf-token" },
        path: { activity_id: "activity-1", expense_id: "expense-1" },
      },
    });
    expect(result).toEqual(metadata);
  });

  it("附件删除 adapter 发送嵌套 ID 与 CSRF 并接受 204", async () => {
    client.DELETE.mockResolvedValue({
      response: new Response(null, { status: 204 }),
    });

    await expect(deleteExpenseAttachment(
      "activity-1",
      "expense-1",
      "attachment-1",
    )).resolves.toBeUndefined();

    expect(client.DELETE).toHaveBeenCalledWith(
      "/api/activities/{activity_id}/expenses/{expense_id}/attachments/{attachment_id}",
      {
        params: {
          header: { "x-csrf-token": "csrf-token" },
          path: {
            activity_id: "activity-1",
            attachment_id: "attachment-1",
            expense_id: "expense-1",
          },
        },
      },
    );
  });
});
