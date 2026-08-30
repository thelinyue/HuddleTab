/** 可聚焦、承载交互语义或显式声明稳定的节点不作为 GSAP target。 */
export function isMotionSafeTarget(target: Element) {
  return !target.matches(
    'a[href], area[href], button, input, select, textarea, summary, iframe, audio[controls], video[controls], [tabindex], [contenteditable]:not([contenteditable="false"]), [data-page-reveal="false"]',
  );
}
