/**
 * 高级公式面板拖拽位置（ZOO-224：面板支持拖拽移动，解决居中遮挡图形）。
 *
 * 会话级模块单例（advancedPanelCollapse 同款惯例）：只存「用户拖过后的位置」，
 * 缺省 null = 面板走调用方布局的自动居中——刷新即回默认，不做持久化（issue
 * 明确为可选增强，非硬性要求）。纯 UI 态：不入元素数据、不入撤销历史。
 *
 * 拖拽几何是纯函数（组件只喂实测矩形与视口尺寸）：核心是边缘 clamp——面板
 * 整体不许出视口，视口装不下时优先保住**左上角（把手所在）**，保证「拖出去
 * 就找不回来」不可能发生。
 *
 * 纯 TS 无 React 依赖（node 单测覆盖，advancedPanelCollapse 同款）。
 */

/** 面板左上角位置（视口 px；fixed 定位坐标系） */
export interface PanelPosition {
  x: number;
  y: number;
}

/** 矩形尺寸（面板实测 size / 视口 size 共用） */
export interface PanelSize {
  width: number;
  height: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/**
 * 边缘 clamp：面板整体留在视口内。视口某维装不下面板时该维夹到 0——
 * 左上角（标题栏把手起点）保持可见，用户永远能把面板拖回来。
 */
export function clampPanelPosition(pos: PanelPosition, panel: PanelSize, viewport: PanelSize): PanelPosition {
  const maxX = Math.max(0, viewport.width - panel.width);
  const maxY = Math.max(0, viewport.height - panel.height);
  return { x: clamp(pos.x, 0, maxX), y: clamp(pos.y, 0, maxY) };
}

/**
 * 拖拽一步：起点 + 指针位移，再整体 clamp。位移不缩放（1:1 跟手），
 * 越界方向被 clamp 吃掉（贴边滑动，不回弹）。
 */
export function dragPanelPosition(
  start: PanelPosition,
  dx: number,
  dy: number,
  panel: PanelSize,
  viewport: PanelSize,
): PanelPosition {
  return clampPanelPosition({ x: start.x + dx, y: start.y + dy }, panel, viewport);
}

/**
 * 会话位置记忆（两入口共用：EquationEditor 创建侧 / MathPlotParams 编辑侧
 * 打开的是同一个面板，拖到哪一侧都记住）。null = 从未拖过，走自动居中。
 */
let storedPosition: PanelPosition | null = null;

/** 读会话位置（未拖过 = null，组件回落居中布局） */
export function getAdvancedPanelPosition(): PanelPosition | null {
  return storedPosition;
}

/** 写会话位置（拖拽落点 / resize 拉回后的新位置） */
export function setAdvancedPanelPosition(pos: PanelPosition | null): void {
  storedPosition = pos;
}

/** 清回自动居中（单测隔离用，模拟刷新） */
export function resetAdvancedPanelPosition(): void {
  storedPosition = null;
}
