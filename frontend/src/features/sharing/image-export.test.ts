import { afterEach, describe, expect, it, vi } from "vitest";

const toPng = vi.hoisted(() => vi.fn().mockResolvedValue("data:image/png;base64,summary"));
vi.mock("html-to-image", () => ({ toPng }));

import { exportSummaryCard } from "./image-export";

describe("exportSummaryCard", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("只捕获指定的 800px 分享卡，并以 2 倍像素下载 PNG", async () => {
    const card = document.createElement("section");
    card.id = "share-summary-card";
    document.body.append(card);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await exportSummaryCard();

    expect(toPng).toHaveBeenCalledWith(card, expect.objectContaining({ pixelRatio: 2, width: 800 }));
    expect(click).toHaveBeenCalledOnce();
  });

  it("已完成请求但仍在解码的卡片图片完成前不开始捕获", async () => {
    let finishDecode: () => void;
    const decoding = new Promise<void>((resolve) => { finishDecode = resolve; });
    const card = document.createElement("section");
    card.id = "share-summary-card";
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", { value: true });
    const decode = vi.fn(() => decoding);
    Object.defineProperty(image, "decode", { value: decode });
    card.append(image);
    document.body.append(card);

    const exporting = exportSummaryCard();
    await Promise.resolve();
    expect(decode).toHaveBeenCalledOnce();
    expect(toPng).not.toHaveBeenCalled();

    finishDecode!();
    await exporting;
    expect(toPng).toHaveBeenCalledOnce();
  });
});
