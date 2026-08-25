/**
 * 箭头端点磁吸绑定几何（ZOO-218，B 路线精确几何）：
 *
 * - bindPoint：统一 API 逐类型求「轮廓吸附点」——rectangle = bbox（即精确轮廓）、
 *   ellipse = 射线闭式解、diamond = 中心射线与四边的交点（L1 范数闭式解，等价
 *   于逐边线段求交）。bbox 近似在菱形对角方向悬空 ~70px、圆 45° 方向悬空 ~41px
 *   （ZOO-208 §2.1），故三类一律精确轮廓；
 * - 捕获 / 解绑：端点到轮廓距离 ≤10px 捕获、14px 解绑滞回（ZOO-153 阈值语义），
 *   屏幕 px 阈值按 viewport.scale 换算为世界 px（同 hitTest 的 8/scale 口径）；
 * - bindPoint / distanceToOutline 自带角度参数（ZOO-208 补充评估 §0.5 预留）：
 *   ZOO-223（PR-R3）起全调用点实装——非 0 时外部点绕元素中心逆旋转进局部系
 *   求值、结果再正旋转回世界系（x/y/width/height 恒为未旋转局部外框，PR-R1
 *   语义），捕获 / 解绑距离在局部系计算对旋转天然不变；
 * - updateBindingsAfterMove 的 movedIds 语义扩展为「轮廓发生变化的元素集合」：
 *   移动 / 缩放 / 旋转（ZOO-223）挂同一重算钩子。
 *
 * 纯函数：不改传入元素；path / line / arrow / text / mathPlot / frame 均非
 * 绑定目标（ZOO-153 结论沿用）。
 */
import { Point, WhiteboardElement, RectangleElement, CircleElement, DiamondElement, ArrowElement, ArrowBinding } from './types';
import { diamondVertices } from './renderer';
import { elementRotation } from './rotation';
import { nearestOnPolyline, lineVertices, parseVertexHandle, isPolyline, polylinePatch } from './polyline';

/** 可绑定元素（v1 白板形状三类；path/line/arrow 自身不作目标） */
export type BindableElement = RectangleElement | CircleElement | DiamondElement;

/** 捕获阈值（屏幕 px）：端点到轮廓距离 ≤ 此值建立绑定 */
export const BIND_CAPTURE_PX = 10;
/** 解绑滞回阈值（屏幕 px）：已绑定端点距离超此值才解除（> 捕获阈值防抖动） */
export const BIND_RELEASE_PX = 14;

export function isBindableElement(el: WhiteboardElement): el is BindableElement {
  return el.type === 'rectangle' || el.type === 'circle' || el.type === 'diamond';
}

/** 元素外框几何中心（角度变换的旋转锚点） */
function frameCenter(el: BindableElement): Point {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

/** 点 p 绕 c 旋转 rad（数学正角 = 屏幕逆时针；PR-R1 存储顺时针度，调用方负责取负） */
function rotateAround(p: Point, c: Point, rad: number): Point {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** 角度（度）模 360 归一化到 [0, 360) */
function normalizeAngleDeg(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

/**
 * 中心射线与形状轮廓的交点（局部系，angle = 0）：射线自几何中心指向 externalPoint
 * 方向，与真实轮廓的交点即吸附点——外部点吸附到轮廓、内部点沿同向射线穿出到轮廓。
 */
function outlinePoint(el: BindableElement, externalPoint: Point): Point {
  const c = frameCenter(el);
  const dx = externalPoint.x - c.x;
  const dy = externalPoint.y - c.y;

  if (el.type === 'rectangle') {
    // 中心射线出 bbox 边：t = min((w/2)/|dx|, (h/2)/|dy|)，取先碰到的边
    const tx = dx !== 0 ? Math.abs(el.width / 2 / dx) : Infinity;
    const ty = dy !== 0 ? Math.abs(el.height / 2 / dy) : Infinity;
    const t = Math.min(tx, ty);
    if (!isFinite(t)) return { x: c.x, y: el.y }; // 外部点恰在中心：退化取上边中点
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  if (el.type === 'circle') {
    // 椭圆圆周闭式解：t = 1/√((dx/rx)² + (dy/ry)²)（ZOO-208 §2.2，三实现中最便宜）
    const rx = Math.abs(el.width / 2);
    const ry = Math.abs(el.height / 2);
    if (rx === 0 || ry === 0 || (dx === 0 && dy === 0)) return { ...c };
    const t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  // diamond：|x'/a| + |y'/b| = 1（L1 范数闭式解）——中心射线必与四边之一相交，
  // 结果与逐边线段求交完全一致（凸四边形 + 内部起点无退化）
  const a = Math.abs(el.width / 2);
  const b = Math.abs(el.height / 2);
  if (a === 0 || b === 0 || (dx === 0 && dy === 0)) return { ...c };
  const t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * 轮廓吸附点（世界系）：端点贴近元素时箭头端点落到真实轮廓上的位置。
 * angle 为元素旋转角（度，顺时针，绕几何中心——PR-R1 存储语义；屏幕系 y 朝下，
 * 代数正角即视觉顺时针）：外部点逆旋转进局部系求轮廓交点、结果正旋转回世界系。
 * ZOO-223（PR-R3）起调用方统一传 elementRotation(el)。
 */
export function bindPoint(el: BindableElement, externalPoint: Point, angle = 0): Point {
  if (normalizeAngleDeg(angle) === 0) return outlinePoint(el, externalPoint);
  const c = frameCenter(el);
  const rad = (angle * Math.PI) / 180;
  const local = rotateAround(externalPoint, c, -rad); // 世界 → 局部（元素旋转的逆）
  return rotateAround(outlinePoint(el, local), c, rad); // 局部 → 世界
}

/**
 * 点到形状真实轮廓的距离（世界 px，捕获 / 解绑判定的统一口径）：
 * rectangle = 到 bbox 边线距离（精确）；diamond = 到四边折线最近距离
 * （nearestOnPolyline 复用，精确）；ellipse = 径向距离近似（点与 bindPoint
 * 轮廓点的直线距，内外点同式——ZOO-208 §2.2 认可的近似，10/14px 阈值带内足够；
 * 恰在圆心时径向退化，取 min(rx, ry)）。
 */
export function distanceToOutline(el: BindableElement, point: Point, angle = 0): number {
  const p = normalizeAngleDeg(angle) === 0
    ? point
    : rotateAround(point, frameCenter(el), -(angle * Math.PI) / 180);

  if (el.type === 'rectangle') {
    const left = el.x;
    const right = el.x + el.width;
    const top = el.y;
    const bottom = el.y + el.height;
    const inside = p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
    if (inside) {
      return Math.min(p.x - left, right - p.x, p.y - top, bottom - p.y);
    }
    const cx = Math.min(Math.max(p.x, left), right);
    const cy = Math.min(Math.max(p.y, top), bottom);
    return Math.hypot(p.x - cx, p.y - cy);
  }

  if (el.type === 'diamond') {
    const verts = diamondVertices(el);
    const near = nearestOnPolyline(p, [...verts, verts[0]]);
    return near ? near.dist : Infinity;
  }

  // ellipse：径向距离近似（内外点统一：沿中心→点射线到圆周的直线距离）
  const c = frameCenter(el);
  if (p.x === c.x && p.y === c.y) return Math.min(Math.abs(el.width / 2), Math.abs(el.height / 2));
  const outline = outlinePoint(el, p);
  return Math.hypot(p.x - outline.x, p.y - outline.y);
}

/**
 * 缩放手柄是否作用于箭头端点（ZOO-218）：p1/p2 端点手柄，或折线编辑态的首/尾
 * 顶点手柄（v0 / v末位，语义同端点——vertexDragPatch 注释口径）；中间顶点返回
 * null（不参与磁吸）。line 元素也可调用，但绑定解析仅对 arrow 生效。
 */
export function endpointHandleSide(handle: string, el: ArrowElement): 'start' | 'end' | null {
  if (handle === 'p1') return 'start';
  if (handle === 'p2') return 'end';
  const vi = parseVertexHandle(handle);
  if (vi == null) return null;
  if (vi === 0) return 'start';
  if (vi === lineVertices(el).length - 1) return 'end';
  return null;
}

/** 两个绑定引用是否指向同一元素（undefined / null 视为无绑定，相等） */
export function arrowBindingEquals(a?: ArrowBinding | null, b?: ArrowBinding | null): boolean {
  return (a?.elementId ?? null) === (b?.elementId ?? null);
}

/** 候选绑定命中（findBindingTarget 返回项） */
export interface BindingCandidate {
  element: BindableElement;
  /** 吸附落点（bindPoint 结果，拖拽端点直接改写到此处） */
  point: Point;
  /** 端点到轮廓的世界 px 距离（候选排序用） */
  dist: number;
}

/**
 * 就近捕获：在可绑定元素中找距 world 轮廓最近且 ≤ capturePx 阈值的目标。
 * thresholdPx 为屏幕 px（按 scale 换算世界 px，同 hitTest 的 8/scale 口径）；
 * 距离并列时取数组靠后者（渲染在上层）。excludeIds 剔除箭头自身等。
 */
export function findBindingTarget(
  elements: WhiteboardElement[],
  world: Point,
  scale: number,
  opts?: { capturePx?: number; excludeIds?: string[] }
): BindingCandidate | null {
  const threshold = (opts?.capturePx ?? BIND_CAPTURE_PX) / (scale || 1);
  const exclude = new Set(opts?.excludeIds ?? []);
  let best: BindingCandidate | null = null;
  for (const el of elements) {
    if (!isBindableElement(el) || exclude.has(el.id)) continue;
    const rot = elementRotation(el); // 旋转目标在局部系求距离 / 吸附点（ZOO-223）
    const dist = distanceToOutline(el, world, rot);
    // ≤ 含并列（同距取上层元素），与 hitTest 的 ≤ margin 口径一致
    if (dist <= threshold && (!best || dist <= best.dist)) {
      best = { element: el, point: bindPoint(el, world, rot), dist };
    }
  }
  return best;
}

/** 端点绑定解析结果：binding 为 null = 本次应无绑定（解绑 / 未捕获） */
export interface EndpointBindingResolution {
  binding: ArrowBinding | null;
  /** 端点应落位的世界坐标（绑定 = 吸附点；未绑定 = 原样返回 world） */
  point: Point;
  target: BindableElement | null;
}

/**
 * 端点拖拽的捕获 / 解绑解析（滞回语义，ZOO-153）：
 *
 * - 已绑定目标在 14px（BIND_RELEASE_PX）内维持绑定——超出才允许解绑 / 改绑；
 * - 其余目标在 10px（BIND_CAPTURE_PX）内可捕获；
 * - 两类候选并存时取轮廓距离更近者（指针连续移动下距离连续，无抖动）：
 *   深入另一元素内部时即时改绑，而原绑定在 10–14px 过渡带内不闪烁。
 *
 * arrow 传拖拽起手快照——binding 字段即手势起手时的绑定态，逐帧解析为
 * (起手绑定, 指针位置) 的纯函数，不随帧间写入漂移。
 */
export function resolveEndpointBinding(params: {
  elements: WhiteboardElement[];
  arrow: ArrowElement;
  endpoint: 'start' | 'end';
  world: Point;
  scale: number;
}): EndpointBindingResolution {
  const { elements, arrow, endpoint, world, scale } = params;
  const current = endpoint === 'start' ? arrow.startBinding : arrow.endBinding;

  // 维持项：起手绑定目标仍在（未删除）且在解绑阈值内（旋转目标的距离 / 吸附点
  // 在其局部系求值，ZOO-223）
  let hold: BindingCandidate | null = null;
  if (current) {
    const el = elements.find((e2) => e2.id === current.elementId);
    if (el && isBindableElement(el)) {
      const rot = elementRotation(el);
      const dist = distanceToOutline(el, world, rot);
      if (dist <= BIND_RELEASE_PX / (scale || 1)) {
        hold = { element: el, point: bindPoint(el, world, rot), dist };
      }
    }
  }

  const capture = findBindingTarget(elements, world, scale, { excludeIds: [arrow.id] });

  const chosen =
    hold && (!capture || hold.dist <= capture.dist) ? hold : capture;
  if (!chosen) return { binding: null, point: { ...world }, target: null };
  return { binding: { elementId: chosen.element.id }, point: { ...chosen.point }, target: chosen.element };
}

/**
 * 元素轮廓变化后的绑定跟随（ZOO-220 移动/缩放，ZOO-223 旋转挂同一钩子）：
 * movedIds 内元素轮廓变化后，端点绑定指向它们的箭头把端点重投影到目标新轮廓上
 * （bindPoint 沿目标中心→端点射线求交，旋转目标在局部系求值后转回世界系），
 * 折线形态同步首/尾顶点（polylinePatch 同一语义，杜绝 x2/y2 与 points 双数据源漂移）。
 *
 * 绑定目标不在 movedIds 内的箭头原样返回（组外箭头不指向组内元素时不跟随）；
 * 绑定目标已被删除（find 不到 / 类型不可绑）时同样原样返回——解绑语义由
 * clearBindingsOfDeletedElements 在删除时一次性处理，这里不重复。
 *
 * 纯函数：不改传入元素（lineVertices 对折线返回 el.points 活引用，须先拷贝）。
 */
export function updateBindingsAfterMove(elements: WhiteboardElement[], movedIds: Set<string>): WhiteboardElement[] {
  return elements.map((el) => {
    // 只处理箭头元素
    if (el.type !== 'arrow') return el;

    const startMoved = !!el.startBinding && movedIds.has(el.startBinding.elementId);
    const endMoved = !!el.endBinding && movedIds.has(el.endBinding.elementId);
    if (!startMoved && !endMoved) return el;

    let startPoint = { x: el.x, y: el.y };
    let endPoint = { x: el.x2, y: el.y2 };
    let projected = false;

    // 检查起点绑定
    if (startMoved) {
      const target = elements.find((e) => e.id === el.startBinding!.elementId);
      if (target && isBindableElement(target)) {
        startPoint = bindPoint(target, startPoint, elementRotation(target));
        projected = true;
      }
    }

    // 检查终点绑定
    if (endMoved) {
      const target = elements.find((e) => e.id === el.endBinding!.elementId);
      if (target && isBindableElement(target)) {
        endPoint = bindPoint(target, endPoint, elementRotation(target));
        projected = true;
      }
    }

    if (!projected) return el;

    // 折线箭头：绑定改端点一律走 polylinePatch（ZOO-220）——首尾顶点与 x/y、
    // x2/y2 单一事实源；顶点先拷贝再改写，不污染传入元素的 points 活引用
    if (isPolyline(el)) {
      const pts = lineVertices(el).map((p) => ({ x: p.x, y: p.y }));
      if (startMoved) pts[0] = startPoint;
      if (endMoved) pts[pts.length - 1] = endPoint;
      return { ...el, ...polylinePatch(el, pts) };
    }

    // 普通两点箭头
    return { ...el, x: startPoint.x, y: startPoint.y, x2: endPoint.x, y2: endPoint.y };
  });
}

/**
 * 清除指向已删除元素的绑定（ZOO-220）：当元素被删除时，指向它的箭头的
 * 绑定字段应被清除，端点冻结在当前位置（不报错、不跟随）。
 *
 * @param elements - 当前所有元素数组
 * @param deletedIds - 被删除元素的ID集合
 * @returns 更新后的元素数组（清除绑定后的箭头）
 */
export function clearBindingsOfDeletedElements(elements: WhiteboardElement[], deletedIds: Set<string>): WhiteboardElement[] {
  return elements.map((el) => {
    // 只处理箭头元素
    if (el.type !== 'arrow') return el;

    let updated = false;
    const updates: Partial<ArrowElement> = {};

    // 检查起点绑定是否指向已删除的元素
    if (el.startBinding && deletedIds.has(el.startBinding.elementId)) {
      updates.startBinding = undefined;
      updated = true;
    }

    // 检查终点绑定是否指向已删除的元素
    if (el.endBinding && deletedIds.has(el.endBinding.elementId)) {
      updates.endBinding = undefined;
      updated = true;
    }

    if (!updated) return el;

    // 端点坐标保持不变（冻结在原地），只清除绑定字段
    return { ...el, ...updates };
  });
}
