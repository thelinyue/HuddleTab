import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDirectory = resolve(root, "public/icons");
const source = resolve(iconsDirectory, "icon-source.svg");

/**
 * 图标从仓库内 SVG 以固定参数生成，保证不同发布环境得到相同的 PNG。
 * maskable 图标将源图缩放到中心 60%，为系统的圆形或圆角裁切留下 20% 安全边距。
 */
async function generateIcons() {
  await mkdir(iconsDirectory, { recursive: true });

  await Promise.all([
    render(source, resolve(iconsDirectory, "icon-192.png"), 192),
    render(source, resolve(iconsDirectory, "icon-512.png"), 512),
    renderMaskable(source, resolve(iconsDirectory, "icon-maskable-512.png")),
  ]);
}

async function render(input, output, size) {
  await sharp(input, { density: 512 })
    .resize(size, size)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(output);
}

async function renderMaskable(input, output) {
  const margin = 102;
  const innerSize = 512 - margin * 2;
  await sharp(input, { density: 512 })
    .resize(innerSize, innerSize)
    .extend({
      top: margin,
      right: margin,
      bottom: margin,
      left: margin,
      background: "#0F766E",
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(output);
}

await generateIcons();
