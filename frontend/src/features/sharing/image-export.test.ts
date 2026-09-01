import { describe, expect, it, vi } from "vitest";

const toPng = vi.hoisted(() => vi.fn().mockResolvedValue("data:image/png;base64,summary"));
vi.mock("html-to-image", () => ({ toPng }));

import { exportSummaryCard } from "./image-export";

describe("exportSummaryCard", () => {
  it("只捕获指定的 800px 分享卡，并以 2 倍像素下载 PNG", async () => {
    const card = document.createElement("section");
    card.id = "share-summary-card";
    document.body.append(card);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await exportSummaryCard();

    expect(toPng).toHaveBeenCalledWith(card, expect.objectContaining({ pixelRatio: 2, width: 800 }));
    expect(click).toHaveBeenCalledOnce();
    card.remove();
  });
});
