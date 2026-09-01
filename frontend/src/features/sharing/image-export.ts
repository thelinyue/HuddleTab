import { toPng } from "html-to-image";

async function waitForCardAssets(card: HTMLElement) {
  await document.fonts?.ready;
  await Promise.all([...card.querySelectorAll("img")].map(async (image) => {
    if (image.complete) return;
    await new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }));
}

/** 导出前等待字体与卡片图片稳定，避免高分辨率图片遗漏资源或发生文字回退。 */
export async function exportSummaryCard() {
  const card = document.getElementById("share-summary-card");
  if (!(card instanceof HTMLElement)) throw new Error("找不到分享摘要卡片，请刷新页面后重试。");
  await waitForCardAssets(card);
  const dataUrl = await toPng(card, { cacheBust: true, pixelRatio: 2, width: 800 });
  const download = document.createElement("a");
  download.download = "huddletab-settlement-summary.png";
  download.href = dataUrl;
  download.click();
}
