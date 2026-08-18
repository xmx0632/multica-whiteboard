/**
 * MathPlot 方程模块共享契约。
 *
 * 本文件先于解析（ZOO-134）落地：按技术方案 §7.2 「先定接口再写 UI」的原则，
 * 这里固定编辑器/参数面板与未来解析层之间的类型边界：
 * - StructuralOutcome：4a 结构校验（validate.ts）的返回，explicit 暂无求值函数；
 * - ParseResult：4b mathjs 安全解析（parse.ts）须满足的完整契约（含 fn）；
 * - Polyline / MathViewport：采样折线与数学视窗，MiniPreview 与 4c 采样（sample.ts）共用。
 */
import type { Point } from '../types';

export type EquationKind = 'explicit' | 'circle' | 'ellipse' | 'error';

export interface CircleParams {
  cx: number;
  cy: number;
  r: number;
}

export interface EllipseParams {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** 4a 结构校验结果（validateEquation 的返回）。错误文案沿用交互原型五类。 */
export type StructuralOutcome =
  | { kind: 'explicit' }
  | { kind: 'circle'; params: CircleParams }
  | { kind: 'ellipse'; params: EllipseParams }
  | { kind: 'error'; message: string };

/** 4b 解析契约（mathjs parse→compile，禁 eval）。explicit 在此基础上补齐求值函数。 */
export type ParseResult =
  | { kind: 'explicit'; fn: (x: number) => number }
  | { kind: 'circle'; params: CircleParams }
  | { kind: 'ellipse'; params: EllipseParams }
  | { kind: 'error'; message: string };

/** 采样折线（数学坐标，4c sample.ts 产物；MiniPreview / 主画布 / SVG 导出共用）。 */
export type Polyline = Point[];

/** 数学视窗（数学单位）。 */
export interface MathViewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** 方程确认（回车 / 插入按钮）时编辑器向外提交的载荷。
 *  kind 为 'error' 时同样允许确认 —— 4d 据此生成错误占位元素（交互原型决策 4）。 */
export interface EquationDraftPayload {
  equation: string;
  outcome: StructuralOutcome;
}
