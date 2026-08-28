import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDirectory = resolve(root, "public/icons");
const source = resolve(root, "src/app/icon.png");
const appleIcon = resolve(root, "src/app/apple-icon.png");

/**
 * 图标从用户确认的正式应用图标以固定参数派生，保证不同发布环境得到相同的 PNG。
 * maskable 图标将源图缩放到中心 60%，为系统的圆形或圆角裁切留下 20% 安全边距。
 */
async function generateIcons() {
  await mkdir(iconsDirectory, { recursive: true });

  await Promise.all([
    render(source, appleIcon, 180),
    render(source, resolve(iconsDirectory, "icon-192.png"), 192),
    render(source, resolve(iconsDirectory, "icon-512.png"), 512),
    renderMaskable(source, resolve(iconsDirectory, "icon-maskable-512.png")),
  ]);
}

async function render(input, output, size) {
  await sharp(input)
    .resize(size, size)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(output);
}

async function renderMaskable(input, output) {
  const margin = 102;
  const innerSize = 512 - margin * 2;
  await sharp(input)
    .resize(innerSize, innerSize)
    .extend({
      top: margin,
      right: margin,
      bottom: margin,
      left: margin,
      background: "#146B52",
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(output);
}

await generateIcons();
