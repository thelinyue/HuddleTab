import { useEffect, useLayoutEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Money } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";

export type ActivitySummary = {
  payable: bigint;
  receivable: bigint;
  readiness: "pending" | "error" | "ready";
};

/** 一页对应一个活动主币种；原生滚动负责触摸跟手和吸附，URL 选择同时驱动摘要与列表。 */
export function ActivityCurrencySummary({ summaries, currency, onSelect }: {
  summaries: Array<[string, ActivitySummary]>;
  currency: string;
  onSelect: (currency: string) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const scrolledCurrency = useRef<string | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touching = useRef(false);
  const selectedIndex = summaries.findIndex(([code]) => code === currency);
  const currencyOrder = summaries.map(([code]) => code).join(",");
  const multiple = summaries.length > 1;

  useEffect(() => () => clearTimeout(scrollTimer.current), []);

  function commitScroll() {
    clearTimeout(scrollTimer.current);
    const element = track.current;
    if (!element?.clientWidth || touching.current) return;
    const slides = Array.from(element.children) as HTMLElement[];
    const index = slides.reduce((closest, slide, next) =>
      Math.abs(slide.offsetLeft - element.scrollLeft) < Math.abs(slides[closest].offsetLeft - element.scrollLeft) ? next : closest, 0);
    // 部分触摸环境会停在两页之间；停止滚动后补齐吸附，再更新列表，避免显示半张摘要。
    if (Math.abs(slides[index].offsetLeft - element.scrollLeft) > 1) {
      element.scrollTo({ left: slides[index].offsetLeft, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      return;
    }
    const next = summaries[index]?.[0];
    if (next && next !== currency) {
      scrolledCurrency.current = next;
      onSelect(next);
    }
  }

  function waitForScroll() {
    clearTimeout(scrollTimer.current);
    // 旧版 Safari 没有 scrollend；滚动停止后再联动列表，避免导航更新打断原生吸附。
    scrollTimer.current = setTimeout(commitScroll, 150);
  }

  useLayoutEffect(() => {
    // 手势停稳后的选择不反向重置滚动位置；URL、箭头或键盘切换才主动定位。
    if (scrolledCurrency.current === currency) {
      scrolledCurrency.current = null;
      return;
    }
    const slide = track.current?.children[selectedIndex] as HTMLElement | undefined;
    if (track.current && slide) track.current.scrollLeft = slide.offsetLeft;
  }, [currency, selectedIndex, currencyOrder]);

  return (
    <section className="activity-currency-summary" aria-label="活动币种摘要">
      <div className="activity-currency-summary__viewport">
      <div ref={track} className="activity-currency-summary__track" tabIndex={multiple ? 0 : undefined}
        aria-label={multiple ? "左右滑动切换币种，也可使用左右方向键" : undefined}
        onScroll={waitForScroll} onScrollEnd={commitScroll}
        onTouchStart={() => { touching.current = true; }}
        onTouchEnd={() => { touching.current = false; waitForScroll(); }}
        onTouchCancel={() => { touching.current = false; waitForScroll(); }}
        onKeyDown={(event) => {
          if (!multiple || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = event.key === "Home" ? 0 : event.key === "End" ? summaries.length - 1
            : Math.max(0, Math.min(summaries.length - 1, selectedIndex + (event.key === "ArrowRight" ? 1 : -1)));
          onSelect(summaries[index][0]);
        }}>
        {summaries.map(([code, summary], index) => (
          <div className="activity-currency-summary__slide" key={code} aria-hidden={code !== currency} aria-label={`${code} 跨活动账务摘要`}>
            <dl className="home-summary">
              <div><dt>待支付</dt><dd>{summary.readiness === "pending" ? <span className="home-summary__skeleton" aria-hidden="true" /> : summary.readiness === "error" ? <small className="home-summary__unavailable">暂不可用</small> : <Money value={formatMoney(code, summary.payable)} tone="negative" />}</dd></div>
              <div><dt className="activity-currency-summary__heading"><span>待收款</span>{multiple ? <span className="activity-currency-summary__position" role="status" aria-label={`第 ${index + 1} 个币种，共 ${summaries.length} 个`} aria-atomic="true">{index + 1}/{summaries.length}</span> : null}</dt><dd>{summary.readiness === "pending" ? <span className="home-summary__skeleton" aria-hidden="true" /> : summary.readiness === "error" ? <small className="home-summary__unavailable">暂不可用</small> : <Money value={formatMoney(code, summary.receivable)} tone="positive" />}</dd></div>
            </dl>
          </div>
        ))}
      </div>
      {multiple ? <>
        <button className="activity-currency-summary__arrow activity-currency-summary__arrow--previous" type="button" aria-label="上一个币种" disabled={selectedIndex === 0} onClick={() => onSelect(summaries[selectedIndex - 1][0])}><ChevronLeft aria-hidden="true" size={18} /></button>
        <button className="activity-currency-summary__arrow activity-currency-summary__arrow--next" type="button" aria-label="下一个币种" disabled={selectedIndex === summaries.length - 1} onClick={() => onSelect(summaries[selectedIndex + 1][0])}><ChevronRight aria-hidden="true" size={18} /></button>
      </> : null}
      </div>
    </section>
  );
}
