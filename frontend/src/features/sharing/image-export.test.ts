import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pngBlob = new Blob(["png"], { type: "image/png" });
const toBlob = vi.hoisted(() => vi.fn());
vi.mock("html-to-image", () => ({ toBlob }));

import { exportSummaryCard as captureSummary } from "./image-export";

function exportSummaryCard() {
  return captureSummary({ card: document.getElementById("share-summary-card") as HTMLElement, width: 800, height: 600, page: 1, delivery: "save" });
}

function setCoarsePointer(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches })),
  });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: matches ? 5 : 0 });
}

function setFileSharing(canShare: boolean, share = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "canShare", { configurable: true, value: vi.fn(() => canShare) });
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  return share;
}

describe("exportSummaryCard", () => {
  beforeEach(() => {
    document.body.innerHTML = '<section id="share-summary-card"></section>';
    toBlob.mockResolvedValue(pngBlob);
    setCoarsePointer(false);
    setFileSharing(false);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:summary") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("桌面捕获 800px 卡片并通过临时 Blob URL 下载", async () => {
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await expect(exportSummaryCard()).resolves.toEqual({ kind: "downloaded" });

    const card = document.getElementById("share-summary-card");
    expect(toBlob).toHaveBeenCalledWith(card, expect.objectContaining({ pixelRatio: 2, width: 800 }));
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector("a[download]")).not.toBeInTheDocument();
    vi.advanceTimersByTime(1_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:summary");
  });

  it("触控设备把 PNG File 交给系统分享", async () => {
    setCoarsePointer(true);
    const share = setFileSharing(true);

    await expect(exportSummaryCard()).resolves.toEqual({ kind: "shared" });

    const payload = share.mock.calls[0]?.[0] as ShareData;
    expect(payload.files).toHaveLength(1);
    expect(payload.files?.[0]).toMatchObject({ name: "huddletab-settlement-summary-1.png", type: "image/png" });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("触控设备不支持文件分享时返回可保存的图片预览", async () => {
    setCoarsePointer(true);
    setFileSharing(false);

    await expect(exportSummaryCard()).resolves.toEqual({ kind: "preview", url: "blob:summary", shareFailed: false });
  });

  it("系统分享真实失败时回退预览，用户取消时保持安静", async () => {
    setCoarsePointer(true);
    setFileSharing(true, vi.fn().mockRejectedValueOnce(new Error("denied")));
    await expect(exportSummaryCard()).resolves.toEqual({ kind: "preview", url: "blob:summary", shareFailed: true });

    setFileSharing(true, vi.fn().mockRejectedValueOnce(new DOMException("cancel", "AbortError")));
    await expect(exportSummaryCard()).resolves.toEqual({ kind: "cancelled" });
  });

  it("桌面分享当前页使用可见尺寸和页码生成文件", async () => {
    const share = setFileSharing(true);
    const card = document.getElementById("share-summary-card") as HTMLElement;
    await expect(captureSummary({ card, width: 320, height: 450, page: 3, delivery: "share" })).resolves.toEqual({ kind: "shared" });
    expect(toBlob).toHaveBeenCalledWith(card, expect.objectContaining({ width: 320, height: 450, pixelRatio: 5 }));
    expect(share.mock.calls[0][0].files[0].name).toBe("huddletab-settlement-summary-3.png");
  });

  it("浏览器没有生成 Blob 时提供明确错误", async () => {
    toBlob.mockResolvedValueOnce(null);
    await expect(exportSummaryCard()).rejects.toThrow("浏览器未能生成 PNG 文件");
  });

  it("图片完成解码前不开始捕获", async () => {
    let finishDecode: () => void;
    const decoding = new Promise<void>((resolve) => { finishDecode = resolve; });
    const card = document.getElementById("share-summary-card")!;
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", { value: true });
    Object.defineProperty(image, "decode", { value: vi.fn(() => decoding) });
    card.append(image);

    const exporting = exportSummaryCard();
    await Promise.resolve();
    expect(toBlob).not.toHaveBeenCalled();

    finishDecode!();
    await exporting;
    expect(toBlob).toHaveBeenCalledOnce();
  });
});
