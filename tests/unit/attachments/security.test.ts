import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, beforeAll, expect, it } from "vitest";

import { processAttachmentImage } from "@/server/attachments/image-policy";
import { LocalAttachmentStore } from "@/server/attachments/local-attachment-store";

const temporaryRoots: string[] = [];
let onePixelPng: Buffer;

beforeAll(async () => {
  onePixelPng = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

it.each([
  [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    "image/svg+xml",
    "ATTACHMENT_TYPE_NOT_ALLOWED",
  ],
  [Buffer.alloc(10 * 1024 * 1024 + 1), "image/jpeg", "ATTACHMENT_TOO_LARGE"],
])("拒绝不安全图片：%s", async (bytes, mime, code) => {
  await expect(processAttachmentImage(bytes, mime)).rejects.toMatchObject({
    code,
  });
});

it("拒绝声明类型与图片魔数不一致", async () => {
  await expect(
    processAttachmentImage(onePixelPng, "image/jpeg"),
  ).rejects.toMatchObject({ code: "ATTACHMENT_MIME_MISMATCH" });
});

it("将有效图片重编码为无元数据的 WebP", async () => {
  const image = await processAttachmentImage(onePixelPng, "image/png");

  expect(image.mimeType).toBe("image/webp");
  expect(image.width).toBe(1);
  expect(image.height).toBe(1);
  expect(image.byteSize).toBeGreaterThan(0);
  expect(image.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(image.bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
});

it("本地存储拒绝路径穿越", async () => {
  const root = await mkdtemp(join(tmpdir(), "huddletab-attachments-"));
  temporaryRoots.push(root);

  await expect(
    new LocalAttachmentStore(root).read("../../outside"),
  ).rejects.toMatchObject({ code: "ATTACHMENT_STORAGE_KEY_INVALID" });
});

it("本地存储在受控根目录中写入并读取文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "huddletab-attachments-"));
  temporaryRoots.push(root);
  const store = new LocalAttachmentStore(root);

  await store.write("activity/expense/attachment.webp", Buffer.from("image"));

  await expect(store.read("activity/expense/attachment.webp")).resolves.toEqual(
    Buffer.from("image"),
  );
});
