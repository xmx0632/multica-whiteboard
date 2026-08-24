/**
 * 页跳转动画（ZOO-198 页条点击 / ZOO-205 ←→ 翻页快捷键共用）。
 *
 * rAF 240ms easeOutCubic 平滑对齐到目标视口——页条点击与键盘翻页手感一致；
 * 模块级单例句柄：新跳转开始即取消进行中的动画（连按 ←→ 不叠加竞态）。
 */
import { Viewport } from './types';

const JUMP_MS = 240;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

let rafId: number | null = null;

export function cancelFrameJump() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/** 视口平滑动画到目标（起点取调用时视口；进行中的动画被取代） */
export function animateViewportTo(
  to: Viewport,
  getViewport: () => Viewport,
  setViewport: (vp: Partial<Viewport>) => void,
) {
  if (typeof window === 'undefined') return;
  const from = { ...getViewport() };
  cancelFrameJump();
  const start = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - start) / JUMP_MS);
    const k = easeOutCubic(p);
    setViewport({
      offsetX: from.offsetX + (to.offsetX - from.offsetX) * k,
      offsetY: from.offsetY + (to.offsetY - from.offsetY) * k,
      scale: from.scale + (to.scale - from.scale) * k,
    });
    rafId = p < 1 ? requestAnimationFrame(tick) : null;
  };
  rafId = requestAnimationFrame(tick);
}
