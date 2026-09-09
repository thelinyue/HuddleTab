import { toBlob } from "html-to-image";

export type SummaryImageExportResult =
  | { kind: "shared" | "downloaded" | "cancelled" }
  | { kind: "preview"; url: string; shareFailed: boolean };

async function waitForCardAssets(card: HTMLElement) {
  await document.fonts?.ready;
  await Promise.all([...card.querySelectorAll("img")].map(async (image) => {
    try {
      await image.decode();
      return;
    } catch {
      if (image.complete) return;
    }
    await new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
    try {
      await image.decode();
    } catch {
      // load/error 事件已给出资源的终态；失败图片交由导出库按当前 DOM 处理。
    }
  }));
}

function usesCoarsePointer() {
  return window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

function canShareFile(file: File) {
  if (!navigator.share || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function createPreview(blob: Blob, shareFailed = false): SummaryImageExportResult {
  return { kind: "preview", url: URL.createObjectURL(blob), shareFailed };
}

/**
 * 导出前等待字体与图片稳定，再按设备能力交付 Blob。
 * 触控设备优先使用系统文件分享；不支持时保留预览 URL，让 iPhone 用户仍可长按保存。
 */
export async function exportSummaryCard(options: { card: HTMLElement; width: number; height: number; page: number; delivery: "save" | "share" }): Promise<SummaryImageExportResult> {
  const card = options.card;
  const filename = `huddletab-settlement-summary-${options.page}.png`;
  if (!(card instanceof HTMLElement)) throw new Error("找不到分享摘要卡片，请刷新页面后重试。");
  await waitForCardAssets(card);
  const blob = await toBlob(card, { cacheBust: true, pixelRatio: Math.max(2, 1600 / options.width), width: options.width, height: options.height });
  if (!blob) throw new Error("浏览器未能生成 PNG 文件，请刷新页面后重试。");

  if (options.delivery === "share" || usesCoarsePointer()) {
    if (typeof File === "undefined") return createPreview(blob);
    const file = new File([blob], filename, { type: "image/png" });
    if (!canShareFile(file)) return createPreview(blob);
    try {
      await navigator.share({ files: [file], title: "HuddleTab 结算摘要" });
      return { kind: "shared" };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return { kind: "cancelled" };
      return createPreview(blob, true);
    }
  }

  const url = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.download = filename;
  download.href = url;
  download.hidden = true;
  document.body.append(download);
  download.click();
  download.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return { kind: "downloaded" };
}
