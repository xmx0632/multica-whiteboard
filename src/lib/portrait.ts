/**
 * 手机竖屏适配（ZOO-156）。
 *
 * 与 landscape.ts（ZOO-152）同一模式：判定以纯函数沉淀（单测覆盖），组件只做接线。
 * - isPhonePortrait：粗指针 + 纵向 + 窄视口 → 手机竖屏（平板竖屏 / 桌面 / 横屏均排除）；
 *   与 isPhoneLandscape 互斥，横竖屏共用 nextPanelFold 折叠状态机（phone-compact 事件）；
 * - immersiveToggleMode：沉浸模式切换钮三态（隐藏 / 进入 / 唤回），
 *   沉浸态隐藏全部浮层（whiteboard-chrome），画布铺满。
 */

/** 手机竖屏的宽度上限（px）：iPhone Pro Max 竖屏 430 / Android 主流 ≤ 420，平板 ≥ 680 */
export const PHONE_PORTRAIT_MAX_WIDTH = 500;

export interface PortraitScreenMetrics {
  width: number;
  height: number;
  /** 主指针为粗指针（触摸屏为主，matchMedia('(pointer: coarse)')） */
  coarsePointer: boolean;
}

/**
 * 手机竖屏判定：粗指针 + 高 > 宽 + 宽 ≤ PHONE_PORTRAIT_MAX_WIDTH。
 * 与 CSS 媒体查询 phonePortraitMediaQuery() 语义一致（orientation: portrait 即高 > 宽）。
 */
export function isPhonePortrait({ width, height, coarsePointer }: PortraitScreenMetrics): boolean {
  return coarsePointer && height > width && width <= PHONE_PORTRAIT_MAX_WIDTH;
}

/** 手机竖屏媒体查询串（hook 用，与 isPhonePortrait / globals.css 竖屏块同一阈值） */
export function phonePortraitMediaQuery(): string {
  return `(pointer: coarse) and (orientation: portrait) and (max-width: ${PHONE_PORTRAIT_MAX_WIDTH}px)`;
}

/** 沉浸模式切换钮三态：非竖屏隐藏 | 进入沉浸 | 沉浸中（点击唤回全部浮层） */
export type ImmersiveToggleMode = 'hidden' | 'enter' | 'exit';

export function immersiveToggleMode(portrait: boolean, immersive: boolean): ImmersiveToggleMode {
  if (!portrait) return 'hidden';
  return immersive ? 'exit' : 'enter';
}
