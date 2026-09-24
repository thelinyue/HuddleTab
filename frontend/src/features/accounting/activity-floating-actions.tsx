import { Plus, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

const MotionLink = motion.create(Link);

/**
 * 三个入口各占固定列，权限变化不会移动其他操作；透明容器不拦截流水触控。
 * 测量实际高度供页面留白和更新提示复用，大字体与安全区不依赖固定估计值。
 */
export function ActivityFloatingActions({ activityId, writable, aiAvailable, onManual, onAi }: { activityId: string; writable: boolean; aiAvailable: boolean; onManual: () => void; onAi: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const aiGradientId = useId();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    const group = ref.current!;
    const root = document.documentElement;
    const measure = () => root.style.setProperty("--activity-actions-height", `${group.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    measure();
    const viewport = window.visualViewport;
    const checkKeyboard = (event?: Event) => {
      const active = event?.type === "focusout" ? (event as FocusEvent).relatedTarget : document.activeElement;
      const editing = active instanceof Element && active.matches("input, textarea, select, [contenteditable='true']");
      const compressed = viewport && viewport.scale === 1 && window.innerHeight - viewport.height > 150;
      setKeyboardOpen(Boolean(compressed || editing && window.matchMedia("(pointer: coarse)").matches));
    };
    document.addEventListener("focusin", checkKeyboard);
    document.addEventListener("focusout", checkKeyboard);
    viewport?.addEventListener("resize", checkKeyboard);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--activity-actions-height");
      document.removeEventListener("focusin", checkKeyboard);
      document.removeEventListener("focusout", checkKeyboard);
      viewport?.removeEventListener("resize", checkKeyboard);
    };
  }, []);
  const feedback = { whileTap: reducedMotion ? undefined : { scale: 0.97 }, transition: { duration: 0.2 } };
  return <div ref={ref} className="activity-floating-actions" data-keyboard-open={keyboardOpen || undefined} aria-label="活动操作">
    {aiAvailable ? <motion.button {...feedback} className="activity-floating-action activity-floating-action--ai" type="button" aria-label="智能录入" title="智能录入" data-focus-key="ai-entry" onClick={onAi}><Sparkles className="activity-ai-icon" size={26} stroke={`url(#${aiGradientId})`} aria-hidden="true"><defs><linearGradient id={aiGradientId} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#1594ed" /><stop offset="48%" stopColor="#7960e8" /><stop offset="100%" stopColor="#e65d9c" /></linearGradient></defs></Sparkles></motion.button> : null}
    {writable ? <motion.button {...feedback} className="activity-floating-action activity-floating-action--manual quick-expense-trigger" type="button" aria-label="记一笔" title="记一笔" data-focus-key="manual-entry" onClick={onManual}><Plus size={18} aria-hidden="true" /><span>记一笔</span></motion.button> : null}
    <MotionLink {...feedback} className="activity-floating-action activity-floating-action--settlement" to={`/activities/${encodeURIComponent(activityId)}/settlement`} state={{ settlementFromFeed: true }} data-focus-key="settlement-entry">结算</MotionLink>
  </div>;
}
