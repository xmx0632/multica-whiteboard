/**
 * 手机横屏适配（ZOO-152）。
 *
 * 判定与面板折叠状态机以纯函数沉淀在此（单测覆盖），组件只做接线：
 * - isPhoneLandscape：粗指针 + 横向 + 矮视口 → 手机横屏（平板横屏 / 桌面 / 竖屏均排除）；
 * - nextPanelFold：属性面板（触笔颜色 / 方程 / 参数）的收起-展开状态机，
 *   ZOO-156 起横竖屏共用（phone-compact 事件），仅手机紧凑布局渲染折叠 UI，桌面零变化。
 */

/** 手机横屏的高度上限（px）：iPhone Pro Max 横屏 430 / Android 主流 ≤ 420，平板 ≥ 680 */
export const PHONE_LANDSCAPE_MAX_HEIGHT = 500;

/** 画布触点通知事件（ZOO-152）：Canvas pointerdown → 横屏颜色面板自动收起 */
export const CANVAS_INTERACT_EVENT = 'whiteboard:canvas-interact';

export interface ScreenMetrics {
  width: number;
  height: number;
  /** 主指针为粗指针（触摸屏为主，matchMedia('(pointer: coarse)')） */
  coarsePointer: boolean;
}

/**
 * 手机横屏判定：粗指针 + 宽 > 高 + 高 ≤ PHONE_LANDSCAPE_MAX_HEIGHT。
 * 与 CSS 媒体查询 phoneLandscapeMediaQuery() 语义一致（orientation: landscape 即宽 > 高）。
 */
export function isPhoneLandscape({ width, height, coarsePointer }: ScreenMetrics): boolean {
  return coarsePointer && width > height && height <= PHONE_LANDSCAPE_MAX_HEIGHT;
}

/** 手机横屏媒体查询串（hook 用，与 isPhoneLandscape / globals.css 横屏块同一阈值） */
export function phoneLandscapeMediaQuery(): string {
  return `(pointer: coarse) and (orientation: landscape) and (max-height: ${PHONE_LANDSCAPE_MAX_HEIGHT}px)`;
}

/** 属性面板当前态：默认工具面板（触笔颜色/线宽）| 方程编辑器 | mathPlot 参数 */
export type PanelState = 'tool' | 'equation' | 'mathplot';

export type PanelFold = 'folded' | 'unfolded';

export type PanelFoldEvent =
  /** 折叠 chip 点击：收起 ⇄ 展开 */
  | { type: 'toggle' }
  /** 画布 pointerdown：颜色面板自动收起（方程 / 参数面板调参中不打断） */
  | { type: 'canvas-interact'; panel: PanelState }
  /** 面板态切换：进入方程 / 参数面板自动展开（ƒ 工具点开必须见到编辑器） */
  | { type: 'panel-state'; panel: PanelState }
  /** 手机紧凑布局（横屏 ZOO-152 / 竖屏 ZOO-156）进入 / 离开：进入默认收起，离开恢复常驻展开 */
  | { type: 'phone-compact'; active: boolean };

export function nextPanelFold(prev: PanelFold, event: PanelFoldEvent): PanelFold {
  switch (event.type) {
    case 'toggle':
      return prev === 'folded' ? 'unfolded' : 'folded';
    case 'canvas-interact':
      return event.panel === 'tool' ? 'folded' : prev;
    case 'panel-state':
      return event.panel === 'tool' ? prev : 'unfolded';
    case 'phone-compact':
      return event.active ? 'folded' : 'unfolded';
  }
}
