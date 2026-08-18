/**
 * 采样与断笔（技术方案 §6.2 / D3「采样与渲染目标解耦」）—— 产纯数据折线
 * （数学坐标，y 向上），MiniPreview / 主画布 Path2D / SVG 导出三处共用。
 *
 * 断笔规则：y 非有限（NaN/±Inf/求值异常）断笔；相邻两点跳变超过视窗高度
 * 且双侧均越出视窗（一侧高于顶、一侧低于底）判为渐近线断笔 —— 单侧越出的
 * 陡峭单调曲线（如大定义域 x³）不会误杀（风险 R3 缓解）。
 */
import { parseEquation } from './parse';
import type { CircleParams, EllipseParams, MathViewport, ParseResult, Polyline, PreviewData, StructuralOutcome } from './types';

/** 采样数硬上限（PRD §8 / PM 硬约束，UI 不暴露超限入口，sample 内 clamp）。 */
export const MAX_SAMPLE_COUNT = 2000;
/** 默认采样档位（交互基线：粗 160 / 中 320 / 细 640）。 */
export const DEFAULT_SAMPLE_COUNT = 320;
/** 定义域宽度合法区间。 */
const MIN_DOMAIN_WIDTH = 0.1;
const MAX_DOMAIN_WIDTH = 1000;

export type SampleResult =
  | { polylines: Polyline[]; yMin: number; yMax: number; xMin?: number; xMax?: number }
  | { error: string };

/** 采样档位 clamp：非法值回落默认档，硬上限 2000，下限 2。 */
export function clampSampleCount(count: number): number {
  const n = Math.round(count);
  if (!Number.isFinite(n)) return DEFAULT_SAMPLE_COUNT;
  return Math.min(Math.max(n, 2), MAX_SAMPLE_COUNT);
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.round(p * (sorted.length - 1));
  return sorted[Math.min(Math.max(idx, 0), sorted.length - 1)];
}

/**
 * 稳健 y 视窗自适应（四分位距）：以中位数为中心、1.5×IQR 为半宽，
 * 避免渐近线邻域的极端值（tan 可达数百）把视窗撑爆；退化（常数函数）时
 * 给出 ±max(|中位数|/2, 1) 的最小视窗。
 */
function fitYWindow(finiteYs: number[]): { min: number; max: number } {
  const sorted = [...finiteYs].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const med = percentile(sorted, 0.5);
  const q3 = percentile(sorted, 0.75);
  let spread = 1.5 * (q3 - q1);
  if (!(spread > 1e-9)) spread = Math.max(Math.abs(med) * 0.5, 1);
  return { min: med - spread, max: med + spread };
}

/**
 * 显式函数采样。
 *
 * @param fn        parseEquation 产出的求值函数（异常时返回 NaN）
 * @param view      x 定义域必填；y 视窗可选 —— 省略或非法时按数据四分位自适应，
 *                  断笔判定与返回值均使用最终视窗（返回 yMin/yMin 供调用方对齐）
 * @param count     采样点数（内部 clamp 到 [2, 2000]）
 */
export function sampleExplicit(
  fn: (x: number) => number,
  view: Pick<MathViewport, 'xMin' | 'xMax'> & Partial<Pick<MathViewport, 'yMin' | 'yMax'>>,
  count: number,
): SampleResult {
  const { xMin, xMax } = view;
  if (!(xMin < xMax)) return { error: '定义域无效：xmin 需小于 xmax' };
  const width = xMax - xMin;
  if (width < MIN_DOMAIN_WIDTH - 1e-12 || width > MAX_DOMAIN_WIDTH + 1e-12) {
    return { error: '定义域无效：宽度需在 0.1–1000 之间' };
  }

  const n = clampSampleCount(count);
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  const finiteYs: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = xMin + (width * i) / (n - 1);
    const y = fn(x);
    xs[i] = x;
    ys[i] = y;
    if (Number.isFinite(y)) finiteYs.push(y);
  }
  if (finiteYs.length === 0) return { error: '定义域内无有效值' };

  const auto = fitYWindow(finiteYs);
  const yMin = view.yMin !== undefined && view.yMax !== undefined && view.yMin < view.yMax ? view.yMin : auto.min;
  const yMax = view.yMin !== undefined && view.yMax !== undefined && view.yMin < view.yMax ? view.yMax : auto.max;
  const span = yMax - yMin;

  const polylines: Polyline[] = [];
  let current: Polyline = [];
  const breakHere = () => {
    if (current.length > 0) polylines.push(current);
    current = [];
  };
  for (let i = 0; i < n; i++) {
    const y = ys[i];
    if (!Number.isFinite(y)) {
      breakHere();
      continue;
    }
    if (current.length > 0) {
      const prevY = current[current.length - 1].y;
      const jumpsAcrossWindow =
        span > 0 && ((prevY > yMax && y < yMin) || (y > yMax && prevY < yMin));
      if (jumpsAcrossWindow && Math.abs(y - prevY) > span) breakHere();
    }
    current.push({ x: xs[i], y });
  }
  breakHere();
  return { polylines, yMin, yMax, xMin, xMax };
}

/** 几何方程参数化精确采样（圆/椭圆，θ 0→2π 闭合折线）与适配视窗。 */
export function sampleGeometry(
  kind: 'circle' | 'ellipse',
  params: CircleParams | EllipseParams,
): SampleResult {
  const rx = kind === 'circle' ? (params as CircleParams).r : (params as EllipseParams).rx;
  const ry = kind === 'circle' ? (params as CircleParams).r : (params as EllipseParams).ry;
  const { cx, cy } = params;
  const segments = 120;
  const polyline: Polyline = [];
  for (let i = 0; i <= segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    polyline.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  const padX = rx * 0.15 + 0.5;
  const padY = ry * 0.15 + 0.5;
  return {
    polylines: [polyline],
    xMin: cx - rx - padX,
    xMax: cx + rx + padX,
    yMin: cy - ry - padY,
    yMax: cy + ry + padY,
  };
}

/** 统一采样入口（4c 渲染管线调用）：按 ParseResult 分类分发。 */
export function sampleEquation(
  result: ParseResult,
  opts: { xMin: number; xMax: number; yMin?: number; yMax?: number; sampleCount?: number },
): SampleResult {
  if (result.kind === 'error') return { error: result.message };
  if (result.kind === 'explicit') {
    return sampleExplicit(result.fn, opts, opts.sampleCount ?? DEFAULT_SAMPLE_COUNT);
  }
  return sampleGeometry(result.kind, result.params);
}

/**
 * 编辑器实时预览适配（EquationEditor 的 createPreviewPolylines 注入点实现）。
 * 显式函数用默认视窗 x∈[-10,10] + y 自适应；几何方程用参数化包围盒。
 * 返回 null 表示不出曲线（错误态 / 解析失败），预览仅显示坐标系或错误文案。
 */
export function createPreviewPolylines(equation: string, outcome: StructuralOutcome | ParseResult): PreviewData | null {
  if (outcome.kind === 'error') return null;
  if (outcome.kind !== 'explicit') {
    const sampled = sampleGeometry(outcome.kind, outcome.params);
    if ('error' in sampled) return null;
    return { polylines: sampled.polylines, xMin: sampled.xMin, xMax: sampled.xMax, yMin: sampled.yMin, yMax: sampled.yMax };
  }
  const parsed = parseEquation(equation);
  if (parsed.kind !== 'explicit') return null;
  const sampled = sampleExplicit(parsed.fn, { xMin: -10, xMax: 10 }, DEFAULT_SAMPLE_COUNT);
  if ('error' in sampled) return null;
  return { polylines: sampled.polylines, xMin: -10, xMax: 10, yMin: sampled.yMin, yMax: sampled.yMax };
}
