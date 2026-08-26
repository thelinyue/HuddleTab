import { expect, it, vi } from "vitest";

import { createAttachmentUploader } from "@/pwa/sync-queue/sync-triggers";

it("附件队列使用 clientAttachmentId 上传到对应账单，并保留服务端失败语义", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        error: {
          code: "ATTACHMENT_LIMIT_REACHED",
          message: "每笔消费最多上传 3 张图片。",
        },
      }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    ),
  );
  const upload = createAttachmentUploader(fetcher);

  await expect(
    upload({
      expenseId: "expense-1",
      attachment: {
        id: "pending-1",
        userId: "user-1",
        activityId: "activity-1",
        mutationId: "mutation-1",
        clientAttachmentId: "client-attachment-1",
        fileName: "receipt.png",
        mimeType: "image/png",
        blob: new Blob(["image"], { type: "image/png" }),
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    }),
  ).rejects.toMatchObject({
    status: 422,
    code: "ATTACHMENT_LIMIT_REACHED",
  });

  expect(fetcher).toHaveBeenCalledWith(
    "/api/activities/activity-1/expenses/expense-1/attachments",
    expect.objectContaining({ method: "POST", credentials: "same-origin" }),
  );
  const request = fetcher.mock.calls[0]?.[1] as RequestInit;
  expect(request.body).toBeInstanceOf(FormData);
  expect((request.body as FormData).get("clientAttachmentId")).toBe(
    "client-attachment-1",
  );
});
