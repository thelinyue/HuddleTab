import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

/** 超过这段时间仍未完成初始化探针时，才向用户显示可读的等待状态。 */
export const PWA_SLOW_STATUS_DELAY_MS = 1_000;

/**
 * 独立 PWA 的网页接管层。
 *
 * 原生 PWA 启动画面只能展示静态资源，网页接管后才由这里补上一次
 * 轻量的品牌入场动画。组件不延长请求生命周期，初始化完成就立即允许
 * 真实页面挂载，并通过 AnimatePresence 让启动层自然淡出。
 */
export function PwaLaunchScreen() {
  const isPresent = useIsPresent();
  const reducedMotion = useReducedMotion() === true;
  const [showSlowStatus, setShowSlowStatus] = useState(false);

  useEffect(() => {
    if (!isPresent) return;
    const timer = window.setTimeout(() => setShowSlowStatus(true), PWA_SLOW_STATUS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isPresent]);

  return (
    <motion.div
      className="pwa-launch-screen"
      role="status"
      aria-live="polite"
      aria-label="正在准备伙记"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <motion.div
        className="pwa-launch-screen__content"
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.94, y: 6 }}
        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        transition={
          reducedMotion
            ? { duration: 0.16, ease: "easeOut" }
            : { type: "spring", bounce: 0, duration: 0.38 }
        }
      >
        <img
          className="pwa-launch-screen__icon"
          src="/apple-touch-icon.png"
          alt=""
          width={96}
          height={96}
          draggable={false}
        />
        <div className="pwa-launch-screen__status-slot" aria-hidden="true">
          <AnimatePresence initial={false}>
            {showSlowStatus ? (
              <motion.p
                key="slow-status"
                className="pwa-launch-screen__status"
                initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
                animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <LoaderCircle aria-hidden="true" className="spinner" size={16} />
                <span>正在准备伙记…</span>
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
