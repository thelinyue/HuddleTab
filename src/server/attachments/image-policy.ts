import { createHash } from "node:crypto";

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import { ApplicationError } from "@/server/errors/application-error";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_DIMENSION = 2048;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

/** 已验证、重新编码后的附件图片，调用方只能保存此对象，不能保存原始上传字节。 */
export type ProcessedAttachmentImage = {
  readonly bytes: Buffer;
  readonly mimeType: "image/webp";
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
  readonly sha256: string;
};

/**
 * 浏览器声明的 MIME 不可信。入口按固定顺序限制输入：大小、声明格式、Magic Bytes、
 * 图像解码，最后统一重编码为 WebP，以移除原始元数据并限制像素与最长边。
 */
export async function processAttachmentImage(
  bytes: Buffer,
  declaredMime: string,
): Promise<ProcessedAttachmentImage> {
  if (bytes.byteLength > MAX_BYTES) {
    throw new ApplicationError(
      "ATTACHMENT_TOO_LARGE",
      "图片不能超过 10MB。",
      422,
    );
  }
  if (!allowedMimeTypes.has(declaredMime)) {
    throw new ApplicationError(
      "ATTACHMENT_TYPE_NOT_ALLOWED",
      "仅支持 JPG、PNG 或 WebP 图片，SVG 不受支持。",
      422,
    );
  }
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !allowedMimeTypes.has(detected.mime)) {
    throw new ApplicationError(
      "ATTACHMENT_TYPE_NOT_ALLOWED",
      "无法识别安全的图片格式。",
      422,
    );
  }
  if (detected.mime !== declaredMime) {
    throw new ApplicationError(
      "ATTACHMENT_MIME_MISMATCH",
      "图片类型与实际内容不一致。",
      422,
    );
  }

  try {
    const output = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    const metadata = await sharp(output).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("重编码后的图片缺少尺寸信息");
    }
    return {
      bytes: output,
      mimeType: "image/webp",
      width: metadata.width,
      height: metadata.height,
      byteSize: output.byteLength,
      sha256: createHash("sha256").update(output).digest("hex"),
    };
  } catch {
    throw new ApplicationError(
      "ATTACHMENT_IMAGE_INVALID",
      "图片内容损坏或尺寸超过安全限制。",
      422,
    );
  }
}
