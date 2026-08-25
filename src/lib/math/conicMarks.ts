/**
 * 圆锥曲线标注（ZOO-215）：焦点 / 准线 / 渐近线的几何数据派生。
 *
 * conicMarks：由 conic 探针参数（EllipseParams / HyperbolaParams /
 * ParabolaParams——解析层产物，常量已裁决为具体数值）派生标注几何——
 * 椭圆焦点 F₁F₂、双曲线焦点 + 两条渐近线、抛物线焦点 + 准线。产物为纯数学
 * 坐标数据（与 physics.ts 的 TrajectoryMarks 同一套「数据在渲染层、绘制在
 * 消费方」分层），canvas 与 SVG 导出共用；常量 / 方程改值经渲染签名失效
 * 自动重算，实时联动。
 *
 * 旋转形（含 xy 交叉项）口径与 conic.ts 教学参数（ellipseTeachingInfo 等）
 * 完全一致：rotation 即标准形 X' 轴相对 x 轴的旋转角，先在标准形派生再旋回
 * ——标注坐标与属性面板展示的焦点坐标恒同源。
 */

import type {
  EllipseParams,
  HyperbolaParams,
  MathViewport,
  ParabolaParams,
} from './types';
import type { Point } from '../types';

/** conic 三 kind 的解析产物（ParseResult 的子集，派生入参）。 */
export type ConicParsed =
  | { kind: 'ellipse'; params: EllipseParams }
  | { kind: 'hyperbola'; params: HyperbolaParams }
  | { kind: 'parabola'; params: ParabolaParams };

/** 焦点（数学坐标）+ 文字标签（F₁ / F₂ / F，教学记号、语言无关）。 */
export interface ConicFocus {
  x: number;
  y: number;
  label: string;
}

/** 贯穿线（准线 / 渐近线）：数学坐标两端点——按视窗对角线外延贯穿，消费方裁剪。 */
export interface ConicLine {
  a: Point;
  b: Point;
}

/** 圆锥曲线标注的数学坐标数据（渲染层与 SVG 导出共用）。 */
export interface ConicMarks {
  kind: 'ellipse' | 'hyperbola' | 'parabola';
  /** 椭圆 / 双曲线两焦点 F₁F₂（F₁ = 长轴 / 实轴负方向侧）、抛物线单焦点 F */
  foci: ConicFocus[];
  /** 抛物线准线（⊥ 对称轴、过顶点后方 p 处） */
  directrix?: ConicLine;
  /** 双曲线两条渐近线（过中心、方向 a·eₜ±b·e_c） */
  asymptotes?: ConicLine[];
}

/** 焦点标注点的绘制半径（局部 px，与 POI / 物理标注同规格）。 */
export const CONIC_MARK_RADIUS_PX = 4;

/** 导引虚线（准线 / 渐近线）节律（局部 px；节律参照 PHYSICS_GUIDE_DASH，导引虚线统一节律）。 */
export const CONIC_GUIDE_DASH: readonly number[] = [4, 4];

/** 旋转角有效判定：缺省 / ±0 视为轴对齐（与 conic.ts 教学参数同口径）。 */
const effectiveRotation = (rotation: number | undefined): number | null =>
  rotation !== undefined && Math.abs(rotation) > 1e-9 ? rotation : null;

/**
 * 过基点沿方向的贯穿线段：两端按视窗对角线长度外延（恒覆盖整个绘图区），
 * 端点越界由消费方裁剪（canvas clip / SVG clipPath）。
 */
function spanningLine(base: Point, dirX: number, dirY: number, view: MathViewport): ConicLine {
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len;
  const uy = dirY / len;
  const L = Math.hypot(view.xMax - view.xMin, view.yMax - view.yMin);
  return {
    a: { x: base.x - L * ux, y: base.y - L * uy },
    b: { x: base.x + L * ux, y: base.y + L * uy },
  };
}

/**
 * 椭圆焦点：焦点在长轴上（rx 与 ry 的较大者方向），半焦距 c=√(a²−b²)。
 * 轴对齐：rx≥ry 沿 x 轴、ry>rx 沿 y 轴；旋转形：长轴沿 X'（rotation）或
 * Y'（rotation+90°）——与 ellipseTeachingInfo 的 e 向量同源。
 */
function ellipseMarks(p: EllipseParams): { foci: ConicFocus[] } {
  const a = Math.max(p.rx, p.ry);
  const b = Math.min(p.rx, p.ry);
  const c = Math.sqrt(Math.max(a * a - b * b, 0));
  const rotation = effectiveRotation(p.rotation);
  const majorAlongX = p.rx >= p.ry;
  const ex = rotation === null ? (majorAlongX ? 1 : 0) : majorAlongX ? Math.cos(rotation) : -Math.sin(rotation);
  const ey = rotation === null ? (majorAlongX ? 0 : 1) : majorAlongX ? Math.sin(rotation) : Math.cos(rotation);
  return {
    foci: [
      { x: p.cx - c * ex, y: p.cy - c * ey, label: 'F₁' },
      { x: p.cx + c * ex, y: p.cy + c * ey, label: 'F₂' },
    ],
  };
}

/**
 * 双曲线焦点 + 渐近线：半焦距 c=√(a²+b²)，焦点沿实轴（axis='x' 沿 x /
 * rotation、axis='y' 沿 y / rotation+90°）；渐近线过中心、方向 a·eₜ±b·e_c
 * （eₜ 实轴单位向量、e_c 共轭轴单位向量）——与 hyperbolaTeachingInfo 同源。
 */
function hyperbolaMarks(p: HyperbolaParams, view: MathViewport): { foci: ConicFocus[]; asymptotes: ConicLine[] } {
  const c = Math.hypot(p.a, p.b);
  const rotation = effectiveRotation(p.rotation);
  const etx = rotation === null ? (p.axis === 'x' ? 1 : 0) : Math.cos(rotation);
  const ety = rotation === null ? (p.axis === 'x' ? 0 : 1) : Math.sin(rotation);
  const ecx = -ety;
  const ecy = etx;
  const center = { x: p.h, y: p.k };
  return {
    foci: [
      { x: p.h - c * etx, y: p.k - c * ety, label: 'F₁' },
      { x: p.h + c * etx, y: p.k + c * ety, label: 'F₂' },
    ],
    // 旋转形 rotation 即实轴角（classifyRotated 归一后 axis 为派生展示字段），
    // 与 hyperbolaTeachingInfo 旋转分支同口径——axis 不参与方向判定
    asymptotes: [
      spanningLine(center, p.a * etx + p.b * ecx, p.a * ety + p.b * ecy, view),
      spanningLine(center, p.a * etx - p.b * ecx, p.a * ety - p.b * ecy, view),
    ],
  };
}

/**
 * 抛物线焦点 + 准线：焦点 = 顶点 V + p·e₁（e₁ 开口对称轴单位向量）、
 * 准线 ⊥ 对称轴过 V − p·e₁——与 parabolaTeachingInfo 同源（p 带符号，
 * 符号即开口方向）。
 */
function parabolaMarks(p: ParabolaParams, view: MathViewport): { foci: ConicFocus[]; directrix: ConicLine } {
  const rotation = effectiveRotation(p.rotation);
  const e1x = rotation === null ? (p.axis === 'x' ? 1 : 0) : Math.cos(rotation);
  const e1y = rotation === null ? (p.axis === 'x' ? 0 : 1) : Math.sin(rotation);
  return {
    foci: [{ x: p.h + p.p * e1x, y: p.k + p.p * e1y, label: 'F' }],
    directrix: spanningLine({ x: p.h - p.p * e1x, y: p.k - p.p * e1y }, -e1y, e1x, view),
  };
}

/**
 * conic 参数 → 标注几何数据（ZOO-215）。非 conic kind 返回 null（渲染层
 * 静默忽略、叠加数据保留——方程改回圆锥曲线即恢复）。
 */
export function conicMarks(parsed: ConicParsed, view: MathViewport): ConicMarks {
  switch (parsed.kind) {
    case 'ellipse':
      return { kind: 'ellipse', ...ellipseMarks(parsed.params) };
    case 'hyperbola': {
      const { foci, asymptotes } = hyperbolaMarks(parsed.params, view);
      return { kind: 'hyperbola', foci, asymptotes };
    }
    case 'parabola': {
      const { foci, directrix } = parabolaMarks(parsed.params, view);
      return { kind: 'parabola', foci, directrix };
    }
  }
}
