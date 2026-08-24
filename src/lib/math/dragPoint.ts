/**
 * 可拖点纯函数层（ZOO-201）—— 常量绑定解析 / 拖动写回 / 条目清洗。
 *
 * 点是「常量绑定」的具象化，不是独立坐标：free = (a, b) 两个常量、
 * onCurve = (a, f(a)) 一个常量 + 方程求值。本层不含 React / DOM / 渲染
 * 坐标映射（屏幕层见 lib/dragPoints.ts），只做四件事：
 *
 * 1. 绑定解析（resolveDragPoints）：元素 → 各点的数学坐标（渲染 / 命中 /
 *    导出共用）；绑定不完整（常量缺失 / 非显式 kind）的条目静默跳过。
 * 2. 拖动写回（dragConstantsPatch）：目标数学坐标 → 常量补丁——只触碰
 *    绑定的键（多常量式 y=A·sin(ωx+φ) 拖 A 的点，ω/φ 不动），值经
 *    常量滑块元数据裁剪（clampToSlider 进 [min,max] + roundSliderValue
 *    两位圆整，与 ZOO-197 滑杆拖动同口径）。
 * 3. 沿曲线吸附（snapXOnCurve）：折线采样上取最近点 x——拖动跟手、松手即
 *    在曲线上（y 恒由方程派生，不落常量）。
 * 4. 条目清洗（pruneDragPoints / addDragPoint / removeDragPoint）：
 *    绑定常量消亡 → 条目同步剔除（与 cleanSliderMap 同语义，元素不留悬挂键）。
 */
import { v4 as uuidv4 } from 'uuid';
import type { DraggablePoint, Polyline } from './types';
import { clampToSlider, roundSliderValue, sliderMetaFor, type ConstantSliderMap } from './slider';
import { parseEquation } from './parse';

/** 点位解析产物：数学坐标（成员字段与绑定条目同 id / mode 对齐）。 */
export interface ResolvedDragPoint {
  id: string;
  mode: DraggablePoint['mode'];
  x: number;
  y: number;
}

/** 绑定解析输入（MathPlotElement 的可拖点相关子集；测试可注入字面量）。 */
export interface DragPointHost {
  equation: string;
  kind: string;
  error?: string | null;
  constants?: Record<string, number>;
  constantSliders?: ConstantSliderMap;
  draggablePoints?: DraggablePoint[];
}

/**
 * 单点绑定解析 → 数学坐标。null = 条目当前不生效（绑定常量缺失 / 非显式
 * kind / 方程解析失败）——渲染与命中同口径跳过，数据保留（补齐常量即恢复）。
 * onCurve 的 y 每次按当前常量重新求值（parseEquation 走编译缓存，同方程
 * 重复解析零成本）——常量改动后点恒在曲线上。
 */
export function resolveDragPoint(
  host: DragPointHost,
  point: DraggablePoint,
  fn?: ((x: number) => number) | null,
): ResolvedDragPoint | null {
  const constants = host.constants;
  if (!constants) return null;
  if (point.mode === 'free') {
    if (!(point.xKey in constants) || !point.yKey || !(point.yKey in constants)) return null;
    return { id: point.id, mode: point.mode, x: constants[point.xKey], y: constants[point.yKey] };
  }
  // onCurve：显式函数 + x 常量在场（y 由方程在当前常量 scope 下求值）
  if (host.kind !== 'explicit' || host.error) return null;
  if (!(point.xKey in constants)) return null;
  const evaluate = fn ?? explicitFnOf(host);
  if (!evaluate) return null;
  const x = constants[point.xKey];
  const y = evaluate(x);
  if (!Number.isFinite(y)) return null;
  return { id: point.id, mode: point.mode, x, y };
}

/** 全部生效点位（渲染 / 命中遍历共用）；无条目或全不生效返回空数组。 */
export function resolveDragPoints(host: DragPointHost): ResolvedDragPoint[] {
  const points = host.draggablePoints;
  if (!points || points.length === 0) return [];
  const fn = host.kind === 'explicit' && !host.error ? explicitFnOf(host) : undefined;
  const out: ResolvedDragPoint[] = [];
  for (const p of points) {
    const r = resolveDragPoint(host, p, fn);
    if (r) out.push(r);
  }
  return out;
}

/** 方程在当前常量 scope 下的求值函数（编译缓存命中，非显式 / 失败返回 null）。 */
function explicitFnOf(host: DragPointHost): ((x: number) => number) | null {
  const parsed = parseEquation(host.equation, undefined, host.constants);
  return parsed.kind === 'explicit' ? parsed.fn : null;
}

/**
 * 沿曲线吸附：折线采样上取离目标最近点（二维距离——拖动跟手而非仅 x 投影），
 * 返回其 x 作为写回值。无可用采样（全断笔）回落目标 x（y 由求值兜底）。
 */
export function snapXOnCurve(polylines: readonly Polyline[], target: { x: number; y: number }): number {
  let bestD2 = Infinity;
  let bestX = target.x;
  for (const pl of polylines) {
    for (const p of pl) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const d2 = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestX = p.x;
      }
    }
  }
  return bestX;
}

/**
 * 拖动写回（常量补丁）：目标数学坐标 → 新 constants 全量快照。
 * - free：x/y 各写各的绑定键；
 * - onCurve：只写 x 绑定键（target.x 应为 snapXOnCurve 的吸附值，y 恒由
 *   方程派生不落常量）；
 * - 值经 sliderMetaFor 元数据裁剪 + 圆整（缺省回落 DEFAULT_SLIDER，ZOO-197
 *   滑杆拖动同口径）——常量的值域契约由滑块元数据持有，点拖动不越界。
 * 只触碰绑定键（其余常量原样保留）；条目不生效 / 无常量返回 null（不动元素）。
 */
export function dragConstantsPatch(
  host: DragPointHost,
  point: DraggablePoint,
  target: { x: number; y: number },
): Record<string, number> | null {
  const constants = host.constants;
  if (!constants) return null;
  const write = (key: string, v: number): number =>
    roundSliderValue(clampToSlider(v, sliderMetaFor(host.constantSliders, key)));

  if (point.mode === 'onCurve') {
    if (!(point.xKey in constants)) return null;
    return { ...constants, [point.xKey]: write(point.xKey, target.x) };
  }
  if (!point.yKey || !(point.xKey in constants) || !(point.yKey in constants)) return null;
  return {
    ...constants,
    [point.xKey]: write(point.xKey, target.x),
    [point.yKey]: write(point.yKey, target.y),
  };
}

/**
 * 条目清洗：剔除绑定常量已消亡的条目（free 需 x/y 两键、onCurve 需 x 键；
 * 与 cleanSliderMap 同语义）。空结果返回 undefined（元素不留空壳字段，
 * 序列化零键）；无条目输入原样返回 undefined。
 */
export function pruneDragPoints(
  points: DraggablePoint[] | undefined,
  constants: Record<string, number> | undefined,
): DraggablePoint[] | undefined {
  if (!points || points.length === 0) return undefined;
  const kept = points.filter((p) =>
    p.mode === 'onCurve'
      ? constants != null && p.xKey in constants
      : constants != null && p.yKey != null && p.xKey in constants && p.yKey in constants,
  );
  return kept.length > 0 ? kept : undefined;
}

/** 同型去重判定（mode + 绑定键一致视为同一点——同键同型重复添加无意义）。 */
function isDuplicate(points: readonly DraggablePoint[], cand: DraggablePoint): boolean {
  return points.some(
    (p) => p.mode === cand.mode && p.xKey === cand.xKey && p.yKey === cand.yKey,
  );
}

/**
 * 添加条目（面板「+ 沿曲线点 / + 自由点」）：同型重复返回 null（调用方不落
 * 键不提交）；成功返回新数组（uuidv4 新 id，原数组不动）。
 */
export function addDragPoint(
  points: DraggablePoint[] | undefined,
  cand: Omit<DraggablePoint, 'id'>,
): DraggablePoint[] | null {
  const current = points ?? [];
  const next: DraggablePoint = { id: uuidv4(), ...cand };
  if (isDuplicate(current, next)) return null;
  return [...current, next];
}

/** 移除条目（面板行 ×）：目标不存在返回 null；空结果归一 undefined（不落空壳键）。 */
export function removeDragPoint(
  points: DraggablePoint[] | undefined,
  id: string,
): DraggablePoint[] | undefined | null {
  if (!points || !points.some((p) => p.id === id)) return null;
  const kept = points.filter((p) => p.id !== id);
  return kept.length > 0 ? kept : undefined;
}

/** 两份常量快照是否逐键相等（拖动收口判变——无实效拖动不压历史）。 */
export function constantsEqual(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => b[k] === a[k]);
}
