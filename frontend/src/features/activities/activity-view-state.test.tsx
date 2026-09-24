import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityViewProvider, useActivityPagePosition } from "./activity-view-state";

function ReadingPage({ ready }: { ready: boolean }) {
  const { containerRef, capturePosition, restorePosition } = useActivityPagePosition("feed", ready);
  const [completed, setCompleted] = useState(false);
  return <div ref={containerRef}>
    {!completed ? <div data-reading-key="first"><button data-focus-key="first" onClick={() => { capturePosition(); setCompleted(true); restorePosition(); }}>完成第一笔</button></div> : null}
    <div data-reading-key="next"><button data-focus-key="next">下一笔</button></div>
  </div>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("活动阅读状态", () => {
  it("首次队列加载晚于列表时，不在就绪后重置用户已经开始的滚动", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const { rerender } = render(<ActivityViewProvider><ReadingPage ready={false} /></ActivityViewProvider>);
    scroll.mockClear();
    vi.spyOn(window, "scrollY", "get").mockReturnValue(500);
    rerender(<ActivityViewProvider><ReadingPage ready /></ActivityViewProvider>);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("按钮点击不产生原生焦点时，完成记录后仍能把焦点交给邻近操作", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 80, top: 80, bottom: 124, left: 0, right: 100, width: 100, height: 44, toJSON: () => ({}) });
    render(<ActivityViewProvider><ReadingPage ready /></ActivityViewProvider>);
    // fireEvent.click 不替浏览器聚焦按钮，覆盖 Safari 的实际点击行为。
    fireEvent.click(screen.getByRole("button", { name: "完成第一笔" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "下一笔" })).toHaveFocus());
  });
});
