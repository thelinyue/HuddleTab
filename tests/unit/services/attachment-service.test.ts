import { randomUUID } from "node:crypto";

import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  process: vi.fn(),
}));

vi.mock("@/server/permissions/authorize-activity-operation", () => ({
  authorizeActivityOperation: mocks.authorize,
}));
vi.mock("@/server/attachments/image-policy", () => ({
  processAttachmentImage: mocks.process,
}));

import { AttachmentService } from "@/server/services/attachment-service";

it("元数据写入失败时删除已落盘的私有文件", async () => {
  const storageKey = new Set<string>();
  const store = {
    write: vi.fn(async (key: string) => {
      storageKey.add(key);
    }),
    read: vi.fn(),
    remove: vi.fn(async (key: string) => {
      storageKey.delete(key);
    }),
  };
  mocks.authorize.mockResolvedValueOnce(undefined);
  mocks.process.mockResolvedValueOnce({
    bytes: Buffer.from("image"),
    mimeType: "image/webp",
    width: 1,
    height: 1,
    byteSize: 5,
    sha256: "digest",
  });
  const transaction = vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    if (query.includes("from expenses")) return [{ id: "expense-1" }];
    if (query.includes("insert into expense_attachments"))
      throw new Error("元数据写入失败");
    if (query.includes("client_attachment_id")) return [];
    if (query.includes("count(*)")) return [{ count: "0" }];
    throw new Error(`未预期查询：${query}`);
  });
  const sql = {
    begin: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  };

  await expect(
    new AttachmentService(sql as never, store).upload({
      session: { user: { id: "user-1" } },
      activityId: "activity-1",
      expenseId: "expense-1",
      clientAttachmentId: randomUUID(),
      declaredMime: "image/png",
      bytes: Buffer.from("image"),
    }),
  ).rejects.toThrow("元数据写入失败");

  expect(store.write).toHaveBeenCalledOnce();
  expect(store.remove).toHaveBeenCalledWith(
    expect.stringMatching(/^activity-1\/expense-1\/.+\.webp$/),
  );
  expect(storageKey).toEqual(new Set());
});
