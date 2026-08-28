/** 可聚焦或承载交互语义的节点永远不作为 GSAP target；需要反馈时动画其非交互包装层。 */
export function isMotionSafeTarget(target: Element) {
  return !target.matches(
    'a[href], area[href], button, input, select, textarea, summary, iframe, audio[controls], video[controls], [tabindex], [contenteditable]:not([contenteditable="false"])',
  );
}
