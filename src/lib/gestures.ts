import { Point, Viewport } from './types';

/**
 * 触摸手势层（ZOO-144 移动端适配）。
 *
 * 判定与 viewport 数学以纯函数沉淀在此（单测覆盖），Canvas.tsx 只做事件接线：
 * - 单指 → 当前工具操作（画笔/图形/文本/选择/橡皮擦）；
 * - 双指 → 画布平移 + 捏合缩放（缩放中心跟随双指中点）；
 * - wheel 缩放与捏合缩放共用同一锚定数学（zoomAt），保证两种通道手感一致。
 */

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;

export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * 以屏幕点 anchor 为缩放中心求新 viewport（anchor 下的世界点在缩放后不动）。
 * 与原 wheel 处理公式代数等价（wheel 迁移到此处，桌面行为零变化）。
 */
export function zoomAt(viewport: Viewport, anchor: Point, nextScale: number): Viewport {
  const scale = clampScale(nextScale);
  return {
    offsetX: anchor.x - (anchor.x - viewport.offsetX) * (scale / viewport.scale),
    offsetY: anchor.y - (anchor.y - viewport.offsetY) * (scale / viewport.scale),
    scale,
  };
}

/**
 * 屏幕位移 → 平移 viewport（手型工具 / 空格 / 中键拖动共用，ZOO-157）。
 * 屏幕系与偏移同系（offset 即世界原点的屏幕坐标），dx/dy 直接叠加，scale 不变。
 */
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, offsetX: viewport.offsetX + dx, offsetY: viewport.offsetY + dy };
}

export interface PinchSnapshot {
  /** 手势开始时的 viewport 快照 */
  viewport: Viewport;
  /** 起点 A（画布 rect 相对屏幕坐标） */
  a: Point;
  /** 起点 B */
  b: Point;
}

/**
 * 双指捏合 + 平移的合成 viewport。
 *
 * scale 按两指距离比例缩放；起点中点下的世界点在手势全程保持在当前中点下 ——
 * 平移（中点位移）与缩放（距离变化）由该不变量一次解出，无需分支。
 */
export function pinchViewport(snapshot: PinchSnapshot, a: Point, b: Point): Viewport {
  const start = snapshot.viewport;
  const startDist = distance(snapshot.a, snapshot.b) || 1; // 双指重合的退化保护
  const scale = clampScale(start.scale * (distance(a, b) / startDist));
  const midStart = midpoint(snapshot.a, snapshot.b);
  const world = {
    x: (midStart.x - start.offsetX) / start.scale,
    y: (midStart.y - start.offsetY) / start.scale,
  };
  const mid = midpoint(a, b);
  return {
    offsetX: mid.x - world.x * scale,
    offsetY: mid.y - world.y * scale,
    scale,
  };
}

/**
 * 单指 / 双指判定：活跃触摸指针 ≥ 2 即提升为 pinch（画布平移缩放），
 * 单指回落为当前工具操作。双指落下瞬间取消进行中的工具手势（不产生元素）。
 */
export function shouldPromoteToPinch(activeTouchCount: number): boolean {
  return activeTouchCount >= 2;
}
