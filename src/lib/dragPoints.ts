/**
 * 可拖点交互层（ZOO-201）—— 屏幕空间命中 / 坐标反解 / 悬停高亮位。
 *
 * 纯函数 + 与 poi.ts 同一条坐标映射链（mathPlotMapper：同一份 resolvePlotRender
 * 缓存 + 同一个内边距常量），保证「所见（renderer 绘制）即所拖（本层命中）」。
 * 数学 / 写回语义在 math/dragPoint.ts；本层只做屏幕编排，不依赖 React。
 *
 * 事件语义（Canvas 调用方）：pointerdown 命中 → 起手势（选中父元素、快照
 * before）；pointermove 反解屏幕 → 数学坐标 → onCurve 经 snapXOnCurve 吸附 →
 * dragConstantsPatch 直改（D5 静默直改）；pointerup 常量有实效变化才压一条
 * 快照——撤销一次回到拖动前。
 */
import type { MathPlotElement, Point, Viewport, WhiteboardElement } from './types';
import type { DraggablePoint } from './math/types';
import { dragConstantsPatch, resolveDragPoints, snapXOnCurve } from './math/dragPoint';
import { mathPlotSpecOf } from './renderer';
import { plotTokenFor } from './math/cache';
import { mathPlotMapper } from './poi';
import { resolvePlotRender } from './math/plot';

/** 点击 / 悬停命中半径（屏幕 px；触摸通道由调用方放大）。 */
export const DRAG_POINT_HIT_PX = 12;

/** 生效点位 + 屏幕坐标（悬停高亮层 / 命中共用）。 */
export interface DragPointSpot {
  elementId: string;
  pointId: string;
  mode: DraggablePoint['mode'];
  x: number;
  y: number;
  screen: Point;
}

/**
 * 元素的全部生效点位（屏幕 px）：仅显式函数且无错误（数学层 resolveDragPoints
 * 同口径过滤）；渲染缓存命中零成本。mapper 不可得（错误态 / 非法尺寸）为空。
 */
export function dragPointSpots(el: MathPlotElement, viewport: Viewport): DragPointSpot[] {
  const mapper = mathPlotMapper(el, viewport);
  if (!mapper) return [];
  return resolveDragPoints(el).map((r) => ({
    elementId: el.id,
    pointId: r.id,
    mode: r.mode,
    x: r.x,
    y: r.y,
    screen: mapper.toScreen(r.x, r.y),
  }));
}

export interface DragPointHitOptions {
  /** 命中半径（屏幕 px，缺省 DRAG_POINT_HIT_PX） */
  radiusPx?: number;
}

/**
 * 点击命中（屏幕 px，全场择近）：点可被点中即被拖动——返回目标元素 / 条目 /
 * 当前屏幕位。无命中返回 null（调用方走 POI / 元素选中既有路径）。
 */
export function hitTestDragPoint(
  elements: WhiteboardElement[],
  screen: Point,
  viewport: Viewport,
  opts?: DragPointHitOptions,
): DragPointSpot | null {
  const radius = opts?.radiusPx ?? DRAG_POINT_HIT_PX;
  const r2 = radius * radius;
  let best: DragPointSpot | null = null;
  let bestD2 = Infinity;
  for (const el of elements) {
    if (el.type !== 'mathPlot' || el.error) continue;
    for (const spot of dragPointSpots(el, viewport)) {
      const d2 = (spot.screen.x - screen.x) ** 2 + (spot.screen.y - screen.y) ** 2;
      if (d2 <= r2 && d2 < bestD2) {
        best = spot;
        bestD2 = d2;
      }
    }
  }
  return best;
}

/**
 * 拖动一步的常量补丁（pointermove 直改载荷）：屏幕位 → 数学坐标（mapper 逆
 * 映射）→ onCurve 折线吸附（渲染缓存同一份 polylines）→ 常量写回。
 * 返回 null 表示本步无动作（条目失效 / 映射不可得）。
 */
export function dragStepPatch(
  el: MathPlotElement,
  pointId: string,
  screen: Point,
  viewport: Viewport,
): { constants: Record<string, number> } | null {
  const point = el.draggablePoints?.find((p) => p.id === pointId);
  if (!point) return null;
  const mapper = mathPlotMapper(el, viewport);
  if (!mapper) return null;
  const math = mapper.toMath(screen.x, screen.y);
  let target = { x: math.x, y: math.y };
  if (point.mode === 'onCurve') {
    // 吸附：渲染缓存同一份采样折线上取最近点 x（y 恒由方程派生）
    const render = resolvePlotRender(mathPlotSpecOf(el), { width: el.width, height: el.height }, plotTokenFor(el.id));
    target = { x: snapXOnCurve(render.polylines, math), y: math.y };
  }
  const constants = dragConstantsPatch(el, point, target);
  return constants ? { constants } : null;
}
