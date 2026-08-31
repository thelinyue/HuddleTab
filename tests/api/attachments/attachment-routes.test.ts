import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "alice" } }),
  sessionUserId: vi.fn().mockReturnValue("alice"),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/services/attachment-service", () => ({
  AttachmentService: class {
    upload = mocks.upload;
    download = mocks.download;
  },
}));

import { POST } from "@/app/api/activities/[activityId]/expenses/[expenseId]/attachments/route";
import { GET } from "@/app/api/activities/[activityId]/expenses/[expenseId]/attachments/[attachmentId]/route";

const activityId = "6a0ab3aa-1b31-4d32-98cd-3ccef27ad72f";
const expenseId = "d1ea226f-83db-4f49-b930-4180028e2ea8";
const attachmentId = "e4b526f9-5299-4a98-b366-366492a7d0a4";
const clientAttachmentId = "5b921635-1a8c-40ba-b858-95da8084c2c8";

it("幂等重放上传返回 200 且不暴露 storageKey", async () => {
  mocks.upload.mockResolvedValueOnce({
    attachment: {
      id: attachmentId,
      filename: "receipt.webp",
      mimeType: "image/webp",
    },
    idempotentReplay: true,
  });
  const formData = new FormData();
  formData.set(
    "file",
    new File(["image"], "receipt.png", { type: "image/png" }),
  );
  formData.set("clientAttachmentId", clientAttachmentId);

  const response = await POST(
    new Request("http://localhost/api/attachments", {
      method: "POST",
      body: formData,
    }),
    { params: Promise.resolve({ activityId, expenseId }) },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: expect.not.objectContaining({ storageKey: expect.anything() }),
  });
});

it("上传在解析 multipart 前拒绝超过受限总字节的请求", async () => {
  mocks.upload.mockReset();
  const response = await POST(
    new Request("http://localhost/api/attachments", {
      method: "POST",
      headers: { "content-length": String(11 * 1024 * 1024) },
      body: new FormData(),
    }),
    { params: Promise.resolve({ activityId, expenseId }) },
  );

  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    error: { code: "ATTACHMENT_TOO_LARGE" },
  });
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("下载将嵌套路由的消费 ID 一并交给服务层并设置私有响应头", async () => {
  mocks.download.mockResolvedValueOnce({
    mimeType: "image/webp",
    bytes: Buffer.from("image"),
  });

  const response = await GET(new Request("http://localhost/api/attachments"), {
    params: Promise.resolve({ activityId, expenseId, attachmentId }),
  });

  expect(mocks.download).toHaveBeenCalledWith(
    { user: { id: "alice" } },
    activityId,
    expenseId,
    attachmentId,
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Type")).toBe("image/webp");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});
