/**
 * POI 交互层（ZOO-199）—— 悬停坐标追踪 / 灰点提示 / 标注切换。
 *
 * 纯函数 + 交点对 memo：数学求解在 math/poi.ts（变号 + 二分），本层负责
 * 元素级编排——数学坐标 → 屏幕 px 映射（与 renderer 绘制同一条链：同一份
 * resolvePlotRender 缓存 + 同一个内边距常量）、多曲线择近、点击目标命中、
 * 标注增删补丁。供 Canvas 事件与渲染共用；不依赖 React。
 *
 * 展示策略：灰点提示仅对「选中或悬停贴近」的元素出现（点击曲线选中 →
 * 灰点浮现 → 点灰点落标注，两步交互；板面无选态时不撒点，保持整洁）；
 * 已持久化标注恒可见、恒可点（再点一次即删）。
 */
import { v4 as uuidv4 } from 'uuid';
import type { MathPlotElement, Point, Viewport, WhiteboardElement } from './types';
import type { MathPoiAnnotation } from './math/types';
import { mathPlotSpecOf } from './renderer';
import { plotTokenFor } from './math/cache';
import { parseEquation } from './math/parse';
import { intersectionsOf, type Intersection } from './math/poi';
import { createPlotTransform, PLOT_INNER_PAD, resolvePlotRender } from './math/plot';

/** 悬停吸附阈值（屏幕 px）：光标与曲线采样点的最近距离低于此值才吸附。 */
export const HOVER_SNAP_PX = 24;
/** POI 灰点 / 标注的点击命中半径（屏幕 px）。 */
export const POI_HIT_PX = 10;

// —— 数学坐标 → 屏幕 px（与 drawMathPlotElement 同一条映射链）——

export interface MathToScreen {
  /** 数学坐标 → 画布 rect 相对屏幕 px（越界值未裁剪，调用方按需 clamp） */
  toScreen: (mx: number, my: number) => Point;
  view: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** 数学坐标 → 内嵌绘图区局部 px（clamp 语义与 drawGraphCore 对齐时用） */
  toInnerPx: (mx: number, my: number) => Point;
  /** 内嵌绘图区尺寸（局部 px）——clamp / 反解共用 */
  innerWidth: number;
  innerHeight: number;
  /** 屏幕 px → 数学坐标（ZOO-201 可拖点；toScreen 的逆映射，越界不裁剪） */
  toMath: (sx: number, sy: number) => Point;
}

/**
 * 元素卡片数学坐标 → 屏幕 px 映射（渲染管线同一份数据：resolvePlotRender
 * 缓存命中零成本）。错误态 / 非法尺寸返回 null。
 */
export function mathPlotMapper(el: MathPlotElement, viewport: Viewport): MathToScreen | null {
  if (!(el.width > 0) || !(el.height > 0)) return null;
  const render = resolvePlotRender(mathPlotSpecOf(el), { width: el.width, height: el.height }, plotTokenFor(el.id));
  if (render.error) return null;
  const iw = el.width - PLOT_INNER_PAD * 2;
  const ih = el.height - PLOT_INNER_PAD * 2;
  if (!(iw > 0) || !(ih > 0)) return null;
  const t = createPlotTransform(render.view, iw, ih);
  const { offsetX, offsetY, scale } = viewport;
  const toInnerPx = (mx: number, my: number): Point => ({ x: t.toPxX(mx), y: t.toPxY(my) });
  const toScreen = (mx: number, my: number): Point => {
    const p = toInnerPx(mx, my);
    return {
      x: (el.x + PLOT_INNER_PAD + p.x) * scale + offsetX,
      y: (el.y + PLOT_INNER_PAD + p.y) * scale + offsetY,
    };
  };
  // 逆映射（线性变换直接反解；unitPx 为 transform 内部比例，按视窗跨度重建）
  const spanX = render.view.xMax - render.view.xMin || 1;
  const spanY = render.view.yMax - render.view.yMin || 1;
  const toMath = (sx: number, sy: number): Point => {
    const px = (sx - offsetX) / scale - el.x - PLOT_INNER_PAD;
    const py = (sy - offsetY) / scale - el.y - PLOT_INNER_PAD;
    return {
      x: render.view.xMin + (px / iw) * spanX,
      y: render.view.yMin + ((ih - py) / ih) * spanY,
    };
  };
  return { toScreen, toInnerPx, toMath, view: render.view, innerWidth: iw, innerHeight: ih };
}

/** 数学点是否落在元素可视视窗内（提示灰点只出现在卡片可见区）。 */
export function pointInView(m: MathToScreen, x: number, y: number): boolean {
  return x >= m.view.xMin && x <= m.view.xMax && y >= m.view.yMin && y <= m.view.yMax;
}

// —— 两曲线交点（元素对 memo）——

/** 交点对缓存上限（元素对级；键含双方数学签名，改方程 / 域 / 常量自动失效）。 */
const PAIR_CACHE_MAX = 64;
const pairCache = new Map<string, Intersection[]>();

/** 交点对缓存键：双方 id + 数学输入（方程 / 常量 / 域）——确定性、无碰撞。 */
function pairKey(a: MathPlotElement, b: MathPlotElement): string {
  const one = (el: MathPlotElement) =>
    JSON.stringify([el.id, el.equation, el.constants ?? null, el.xAxis.min, el.xAxis.max]);
  return `${one(a)}|${one(b)}`;
}

/** 交点解析产物缓存句柄（Node 单测复位用）。 */
export function clearPoiPairCache(): void {
  pairCache.clear();
}

/**
 * 两显式曲线元素的交点（定义域交集上 f−g 变号 + 二分，math/poi.ts）。
 * memo：同键直接命中（平移 / 缩放 / 重复帧零重算）；非显式 / 域无交集为空。
 */
export function intersectionsForPair(a: MathPlotElement, b: MathPlotElement): Intersection[] {
  if (a.kind !== 'explicit' || b.kind !== 'explicit' || a.error || b.error) return [];
  const xMin = Math.max(a.xAxis.min, b.xAxis.min);
  const xMax = Math.min(a.xAxis.max, b.xAxis.max);
  if (!(xMax - xMin > 1e-12)) return [];
  const key = pairKey(a, b);
  const hit = pairCache.get(key);
  if (hit) return hit;
  const pa = parseEquation(a.equation, undefined, a.constants);
  const pb = parseEquation(b.equation, undefined, b.constants);
  if (pa.kind !== 'explicit' || pb.kind !== 'explicit') return [];
  const span = Math.max(a.xAxis.max - a.xAxis.min, b.xAxis.max - b.xAxis.min);
  const pts = intersectionsOf(pa.fn, pb.fn, xMin, xMax, span * 10);
  pairCache.set(key, pts);
  while (pairCache.size > PAIR_CACHE_MAX) {
    const oldest = pairCache.keys().next().value;
    if (oldest === undefined) break;
    pairCache.delete(oldest);
  }
  return pts;
}

// —— 灰点提示目标 / 持久化标注目标（屏幕 px，点击命中共用）——

/** 灰点提示（数学坐标 + 屏幕位置；点击后可转持久化标注）。 */
export interface PoiHint {
  elementId: string;
  kind: 'zero' | 'extremum' | 'intersection';
  x: number;
  y: number;
  /** intersection：配对曲线元素 id（标注落元素携带，展示语义） */
  withId?: string;
  screen: Point;
}

/**
 * 元素 E 的全部灰点提示（屏幕 px，视窗内过滤）：自有零点 / 极值（render.pois）
 * + 与画布上其余显式曲线的交点（对 memo）。仅显式函数；错误态 / 无渲染数据为空。
 */
export function poiHintsFor(el: MathPlotElement, elements: WhiteboardElement[], viewport: Viewport): PoiHint[] {
  if (el.kind !== 'explicit' || el.error) return [];
  const mapper = mathPlotMapper(el, viewport);
  if (!mapper) return [];
  const render = resolvePlotRender(mathPlotSpecOf(el), { width: el.width, height: el.height }, plotTokenFor(el.id));
  const hints: PoiHint[] = [];
  for (const x of render.pois?.zeros ?? []) {
    if (!pointInView(mapper, x, 0)) continue;
    hints.push({ elementId: el.id, kind: 'zero', x, y: 0, screen: mapper.toScreen(x, 0) });
  }
  for (const ex of render.pois?.extrema ?? []) {
    if (!pointInView(mapper, ex.x, ex.y)) continue;
    hints.push({ elementId: el.id, kind: 'extremum', x: ex.x, y: ex.y, screen: mapper.toScreen(ex.x, ex.y) });
  }
  for (const other of elements) {
    if (other.id === el.id || other.type !== 'mathPlot') continue;
    for (const p of intersectionsForPair(el, other)) {
      if (!pointInView(mapper, p.x, p.y)) continue;
      hints.push({ elementId: el.id, kind: 'intersection', x: p.x, y: p.y, withId: other.id, screen: mapper.toScreen(p.x, p.y) });
    }
  }
  return hints;
}

/**
 * 持久化标注的屏幕位置（点击删除命中共用）：点收拢回内嵌绘图区内缘——
 * 与 drawGraphCore / SVG 导出的绘制 clamp 同口径（所见即所点）。
 */
export function annotationScreen(el: MathPlotElement, a: MathPoiAnnotation, viewport: Viewport): Point | null {
  const mapper = mathPlotMapper(el, viewport);
  if (!mapper) return null;
  // 内嵌区局部 px clamp（drawGraphCore 同款 [4, size-4]）——直接在局部 px 空间
  // clamp 后换算屏幕，避免数学坐标 clamp 的比例失真；所见即所点
  const p = mapper.toInnerPx(a.x, a.y);
  const lx = Math.min(Math.max(p.x, 4), mapper.innerWidth - 4);
  const ly = Math.min(Math.max(p.y, 4), mapper.innerHeight - 4);
  const { offsetX, offsetY, scale } = viewport;
  return {
    x: (el.x + PLOT_INNER_PAD + lx) * scale + offsetX,
    y: (el.y + PLOT_INNER_PAD + ly) * scale + offsetY,
  };
}

// —— 点击命中 ——

export type PoiHit =
  /** 点中已持久化标注 → 删除（toggle off） */
  | { action: 'remove'; elementId: string; annotationId: string }
  /** 点中灰点提示 → 新增标注（toggle on） */
  | { action: 'add'; elementId: string; kind: PoiHint['kind']; x: number; y: number; withId?: string };

export interface PoiHitOptions {
  /** 命中半径（屏幕 px，缺省 POI_HIT_PX；触摸通道调用方放大） */
  radiusPx?: number;
  /** 灰点提示可见判定（缺省恒真——调用方传「选中或悬停贴近」） */
  hintVisible?: (el: MathPlotElement) => boolean;
}

/**
 * POI 点击命中（屏幕 px）：已持久化标注优先（同点先删后增，toggle 语义），
 * 再灰点提示。半径内取最近。无命中返回 null（调用方走元素选中既有路径）。
 */
export function hitTestPoi(
  elements: WhiteboardElement[],
  screen: Point,
  viewport: Viewport,
  opts?: PoiHitOptions,
): PoiHit | null {
  const radius = opts?.radiusPx ?? POI_HIT_PX;
  const r2 = radius * radius;
  const visible = opts?.hintVisible ?? (() => true);
  // 候选收集后排序：标注（level 1）恒胜灰点（level 0）——同点先删后增的
  // toggle 语义；同级取最近
  const candidates: { d2: number; level: number; hit: PoiHit }[] = [];

  for (const el of elements) {
    if (el.type !== 'mathPlot') continue;
    // 持久化标注（恒可见恒可点）
    if (el.kind === 'explicit' && !el.error && el.poiAnnotations) {
      for (const a of el.poiAnnotations) {
        const p = annotationScreen(el, a, viewport);
        if (!p) continue;
        const d2 = (p.x - screen.x) ** 2 + (p.y - screen.y) ** 2;
        if (d2 <= r2) {
          candidates.push({ d2, level: 1, hit: { action: 'remove', elementId: el.id, annotationId: a.id } });
        }
      }
    }
    // 灰点提示（按可见判定）
    if (!visible(el)) continue;
    for (const h of poiHintsFor(el, elements, viewport)) {
      const d2 = (h.screen.x - screen.x) ** 2 + (h.screen.y - screen.y) ** 2;
      if (d2 <= r2) {
        candidates.push({
          d2,
          level: 0,
          hit: { action: 'add', elementId: h.elementId, kind: h.kind, x: h.x, y: h.y, withId: h.withId },
        });
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.level - a.level || a.d2 - b.d2);
  return candidates[0].hit;
}

/**
 * 标注切换补丁（updateElement 的 updates 载荷）：add 追加一条（新 uuid），
 * remove 剔除指定 id；无标注时补丁为 undefined → 空数组（键保留，语义无标注）。
 * 返回 null 表示无变化（目标不存在）。
 */
export function togglePoiAnnotation(
  el: MathPlotElement,
  hit: PoiHit,
): Partial<MathPlotElement> | null {
  const current = el.poiAnnotations ?? [];
  if (hit.action === 'remove') {
    if (!current.some((a) => a.id === hit.annotationId)) return null;
    return { poiAnnotations: current.filter((a) => a.id !== hit.annotationId) };
  }
  // 同位置去重：同 kind + 坐标（1e-9 容差）已存在则不重复添加
  const dup = current.some(
    (a) => a.kind === hit.kind && Math.abs(a.x - hit.x) < 1e-9 && Math.abs(a.y - hit.y) < 1e-9,
  );
  if (dup) return null;
  const annotation: MathPoiAnnotation = {
    id: uuidv4(),
    kind: hit.kind,
    x: hit.x,
    y: hit.y,
    ...(hit.withId !== undefined ? { withId: hit.withId } : {}),
  };
  return { poiAnnotations: [...current, annotation] };
}

// —— 悬停坐标追踪 ——

export interface HoverTrace {
  /** 吸附到的曲线元素 id */
  elementId: string;
  /** 吸附点数学坐标 */
  x: number;
  y: number;
  /** 光标到采样点的屏幕距离（px，≤ threshold） */
  distPx: number;
}

/**
 * 悬停坐标追踪（ZOO-199）：光标 → 各 mathPlot 曲线采样点的最近屏幕距离，
 * 全场择近（多曲线优先吸附最近曲线——验收口径）；全部超出阈值返回 null。
 * 阈值可调（缺省 HOVER_SNAP_PX，测试注入更小值验证边界）。
 */
export function nearestCurvePoint(
  elements: WhiteboardElement[],
  screen: Point,
  viewport: Viewport,
  thresholdPx: number = HOVER_SNAP_PX,
): HoverTrace | null {
  let best: HoverTrace | null = null;
  for (const el of elements) {
    if (el.type !== 'mathPlot' || el.error) continue;
    const mapper = mathPlotMapper(el, viewport);
    if (!mapper) continue;
    const render = resolvePlotRender(mathPlotSpecOf(el), { width: el.width, height: el.height }, plotTokenFor(el.id));
    for (const pl of render.polylines) {
      for (const p of pl) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const s = mapper.toScreen(p.x, p.y);
        const d = Math.hypot(s.x - screen.x, s.y - screen.y);
        if (d <= thresholdPx && (!best || d < best.distPx)) {
          best = { elementId: el.id, x: p.x, y: p.y, distPx: d };
        }
      }
    }
  }
  return best;
}
