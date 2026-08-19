/**
 * 折线化 line/arrow 的顶点几何（ZOO-168，数据模型方案 A）：
 *
 * line/arrow 携带可选 points（含首尾的完整顶点序列），>2 顶点即折线形态，
 * 无 points / ≤2 顶点为两点退化直线——旧文档零迁移。几何读写统一经本模块，
 * 保证「points 首尾 ↔ x/y 与 x2/y2」单一事实源：
 *
 * - lineVertices：生效顶点序列（折线取 points，直线取两端点）；
 * - polylinePatch：以完整顶点序列产出元素补丁（≤2 顶点时显式清掉 points，
 *   3→2 删除顶点后元素退化为普通直线，与旧格式完全等价）；
 * - insertVertexPatch / removeVertexPatch / vertexDragPatch：编辑态三操作；
 * - nearestOnPolyline：点到折线最近命中（命中测试 + 插点投影共用）。
 *
 * 纯函数：不改原元素，补丁可直接合入 store 的 updateElement / 直改通道。
 */
import { Point, LineElement, ArrowElement } from './types';

/** line / arrow 统称（折线化只作用于这两类元素） */
export type LinearElement = LineElement | ArrowElement;

export function isLinearElement(el: unknown): el is LinearElement {
  const t = (el as { type?: unknown })?.type;
  return t === 'line' || t === 'arrow';
}

/** 元素是否处于折线形态（points 存在且 >2 顶点） */
export function isPolyline(el: LinearElement): boolean {
  return Array.isArray(el.points) && el.points.length > 2;
}

/** 生效顶点序列：折线取 points；普通直线取 (x,y)-(x2,y2) 两点（恒 ≥2） */
export function lineVertices(el: LinearElement): Point[] {
  if (isPolyline(el)) return el.points as Point[];
  return [
    { x: el.x, y: el.y },
    { x: el.x2, y: el.y2 },
  ];
}

/** 编辑态顶点手柄 id（选中框布局 / 命中：v0 … vn-1） */
export type VertexHandle = `v${number}`;

export function vertexHandle(index: number): VertexHandle {
  return `v${index}`;
}

/** 手柄 id → 顶点下标；非顶点手柄返回 null */
export function parseVertexHandle(id: string): number | null {
  const m = /^v(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/**
 * 以完整顶点序列重建元素字段（增删 / 拖动顶点的统一出口）：
 * 首尾同步 x/y 与 x2/y2；>2 顶点写入克隆点集，≤2 顶点显式置 undefined
 * （Object.assign 会覆盖旧数组——3→2 删除场景必须抹掉 points 才退化成直线）。
 */
export function polylinePatch(el: LinearElement, vertices: Point[]): Partial<LineElement> {
  const patch: Partial<LineElement> = {
    x: vertices[0].x,
    y: vertices[0].y,
    x2: vertices[vertices.length - 1].x,
    y2: vertices[vertices.length - 1].y,
  };
  patch.points =
    vertices.length > 2 ? vertices.map((p) => ({ x: p.x, y: p.y })) : undefined;
  return patch;
}

/** 点到折线最近命中：逐段取投影，返回距离 / 段下标 / 参数 t / 投影点 */
export interface PolylineNearest {
  dist: number;
  segIndex: number;
  t: number;
  point: Point;
}

export function nearestOnPolyline(p: Point, vertices: Point[]): PolylineNearest | null {
  if (vertices.length < 2) return null;
  let best: PolylineNearest | null = null;
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    const point = { x: a.x + abx * t, y: a.y + aby * t };
    const dist = Math.hypot(p.x - point.x, p.y - point.y);
    if (!best || dist < best.dist) best = { dist, segIndex: i, t, point };
  }
  return best;
}

/**
 * 双击插点：在最近段的投影点插入顶点（双击直线中段 = 投影落在中段上，
 * 手柄即出现在双击处）。距段端点过近（< minEndDist，世界 px）不插——
 * 双击落在既有顶点手柄或端点附近时避免产生重合顶点。返回补丁 + 新顶点下标。
 */
export function insertVertexPatch(
  el: LinearElement,
  world: Point,
  opts?: { minEndDist?: number }
): { patch: Partial<LineElement>; index: number } | null {
  const vertices = lineVertices(el);
  const near = nearestOnPolyline(world, vertices);
  if (!near) return null;
  const minEnd = opts?.minEndDist ?? 0;
  const a = vertices[near.segIndex];
  const b = vertices[near.segIndex + 1];
  if (Math.hypot(near.point.x - a.x, near.point.y - a.y) < minEnd) return null;
  if (Math.hypot(near.point.x - b.x, near.point.y - b.y) < minEnd) return null;
  const next = vertices.map((p) => ({ x: p.x, y: p.y }));
  next.splice(near.segIndex + 1, 0, { x: near.point.x, y: near.point.y });
  return { patch: polylinePatch(el, next), index: near.segIndex + 1 };
}

/**
 * 删除中间顶点：仅 0 < index < n-1 可删（首尾端点结构性保留）；
 * 删除后 ≤2 顶点由 polylinePatch 置空 points——元素退化为普通直线。
 */
export function removeVertexPatch(el: LinearElement, index: number): Partial<LineElement> | null {
  const vertices = lineVertices(el);
  if (index <= 0 || index >= vertices.length - 1) return null;
  const next = vertices.filter((_, i) => i !== index).map((p) => ({ x: p.x, y: p.y }));
  return polylinePatch(el, next);
}

/** 编辑态拖动第 index 个顶点到 world（v0 / v末位 语义同端点手柄 p1 / p2） */
export function vertexDragPatch(
  el: LinearElement,
  index: number,
  world: Point
): Partial<LineElement> | null {
  const vertices = lineVertices(el).map((p) => ({ x: p.x, y: p.y }));
  if (index < 0 || index >= vertices.length) return null;
  vertices[index] = { x: world.x, y: world.y };
  return polylinePatch(el, vertices);
}
