/**
 * 采样与断笔（技术方案 §6.2 / D3「采样与渲染目标解耦」）—— 产纯数据折线
 * （数学坐标，y 向上），MiniPreview / 主画布 Path2D / SVG 导出三处共用。
 *
 * 断笔规则：y 非有限（NaN/±Inf/求值异常）断笔；相邻两点跳变超过视窗高度
 * 且双侧均越出视窗（一侧高于顶、一侧低于底）判为渐近线断笔 —— 单侧越出的
 * 陡峭单调曲线（如大定义域 x³）不会误杀（风险 R3 缓解）。
 */
import { parseEquation } from './parse';
import type {
  CircleParams,
  EllipseParams,
  HyperbolaParams,
  LineParams,
  MathViewport,
  ParabolaParams,
  ParseResult,
  Polyline,
  PreviewData,
  StructuralOutcome,
} from './types';

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

/** 直线视窗基准半径（数学单位）：原点居中视窗的最小半宽，量级对齐显式默认域 ±10。 */
const LINE_VIEW_BASE = 8;

/** 几何视窗默认纵横比（数学单位 y 跨度 / x 跨度）：对齐默认卡片 480×360。 */
const DEFAULT_ASPECT = 0.75;

/**
 * 等比视窗适配（ZOO-147 修复，惠及全部几何 kind）：几何视窗必须与卡片纵横比
 * 一致（ySpan = aspect·xSpan），否则 4:3 卡片里方形数学视窗会把圆画成椭圆、
 * 直线斜率失真。给定 x/y 半宽需求，返回与卡片纵横比一致且两侧都容纳需求的半宽。
 */
function aspectWindow(needX: number, needY: number, aspect: number): { halfX: number; halfY: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : DEFAULT_ASPECT;
  const halfX = Math.max(needX, needY / a);
  return { halfX, halfY: a * halfX };
}

/**
 * 直线参数化采样（D7 方案 A / 研究报告 §2.3）：直线无自然定义域，
 * 视窗取原点居中（保证坐标轴上下文可见），半宽纳入离原点最近点 P₀ 与两轴
 * 截距；采样折线沿方向向量 (b,−a) 越出视窗对角（两端各 2×最大半宽），
 * 绘制层按卡片矩形天然裁剪——平移缩放不重采样承诺不受影响。
 */
function sampleLine(params: LineParams, aspect: number): SampleResult {
  const { a, b, c } = params;
  if (a === 0 && b === 0) return { error: '该方程不表示直线' };
  const denom = a * a + b * b;
  const p0x = (a * c) / denom; // 直线上离原点最近的点（视窗锚点之一）
  const p0y = (b * c) / denom;
  const xIntercept = a !== 0 && Number.isFinite(c / a) ? Math.abs(c / a) : 0;
  const yIntercept = b !== 0 && Number.isFinite(c / b) ? Math.abs(c / b) : 0;
  const base = Math.max(LINE_VIEW_BASE, Math.abs(p0x), Math.abs(p0y), xIntercept, yIntercept);
  const { halfX, halfY } = aspectWindow(base * 1.15 + 0.5, base * 1.15 + 0.5, aspect); // 15% + 0.5 内边距
  const norm = Math.sqrt(denom);
  const r = 2 * Math.max(halfX, halfY); // 采样半径：必越出视窗对角线，卡片裁剪后两端不缺角
  const dx = b / norm;
  const dy = -a / norm;
  const polyline: Polyline = [
    { x: p0x - r * dx, y: p0y - r * dy },
    { x: p0x + r * dx, y: p0y + r * dy },
  ];
  return { polylines: [polyline], xMin: -halfX, xMax: halfX, yMin: -halfY, yMax: halfY };
}

/**
 * 抛物线参数化采样（ZOO-147 / D7）：(y−k)²=4p(x−h)（axis='x'）取参
 * y=k+t、x=h+t²/(4p)（axis='y' 对换）——单支连续曲线，t 对称采样。
 * 视窗原点居中、纳入顶点/焦点与一段张口（深度 max(4, 3|p|)），t 上限取
 * 「越出上下边」与「越出开口侧边」所需者的较大值（卡片裁剪）。
 */
function sampleParabola(params: ParabolaParams, aspect: number): SampleResult {
  const { h, k, p, axis } = params;
  if (!(Math.abs(p) > 1e-12)) return { error: '该方程不表示抛物线' };
  const depth = Math.max(4, 3 * Math.abs(p)); // 沿开口轴的展示深度
  const spread = Math.sqrt(4 * Math.abs(p) * depth); // 该深度处的张口半宽
  const anchor = Math.abs(p) + 1.5; // 焦点可见余量
  const needOpen = Math.max(LINE_VIEW_BASE, Math.abs(axis === 'x' ? h : k) + Math.max(depth, anchor));
  const needSide = Math.max(6, Math.abs(axis === 'x' ? k : h) + spread + 1);
  const { halfX, halfY } =
    axis === 'x' ? aspectWindow(needOpen, needSide, aspect) : aspectWindow(needSide, needOpen, aspect);
  // t 上限：横竖两侧都越出卡片（1.1 倍余量），保证裁剪后曲线贯穿卡片边缘
  const tSide = 1.1 * (axis === 'x' ? halfY + Math.abs(k) : halfX + Math.abs(h));
  const tOpen = Math.sqrt(4 * Math.abs(p) * 1.1 * (axis === 'x' ? halfX + Math.abs(h) : halfY + Math.abs(k)));
  const tMax = Math.max(tSide, tOpen);
  const n = 200;
  const polyline: Polyline = [];
  for (let i = 0; i <= n; i++) {
    const t = -tMax + (2 * tMax * i) / n;
    polyline.push(axis === 'x' ? { x: h + (t * t) / (4 * p), y: k + t } : { x: h + t, y: k + (t * t) / (4 * p) });
  }
  return { polylines: [polyline], xMin: -halfX, xMax: halfX, yMin: -halfY, yMax: halfY };
}

/** 双曲线每支采样点数（顶点密、远端渐近线性，均匀 t 下视觉平滑）。 */
const HYPERBOLA_SEGMENTS = 140;

/**
 * 双曲线参数化采样（ZOO-147 / D7）：axis='x' 两支 (h±a·cosh t, k+b·sinh t)
 * （axis='y' 对换）。视窗原点居中、纳入中心/顶点/焦点（R=max(a,b,c) 放余量）；
 * t 上限 arcosh 使 a·cosh t / b·sinh t 越出卡片（1.15–1.25 倍余量），卡片裁剪。
 */
function sampleHyperbola(params: HyperbolaParams, aspect: number): SampleResult {
  const { h, k, a, b, axis } = params;
  if (!(a > 0) || !(b > 0)) return { error: '该方程不表示双曲线' };
  const c = Math.hypot(a, b);
  const r = Math.max(a, b, c);
  const { halfX, halfY } = aspectWindow(Math.max(LINE_VIEW_BASE, Math.abs(h) + 1.4 * r), Math.max(6, Math.abs(k) + 1.2 * r), aspect);
  // cosh t ≥ mX 且 sinh t ≥ mY（arcosh 的参数），保证两支都穿出卡片
  const m = Math.max((1.25 * (halfX + Math.abs(h))) / a, (1.15 * (halfY + Math.abs(k))) / b, 1.000001);
  const tMax = Math.log(m + Math.sqrt(m * m - 1)); // arcosh
  const branch = (sign: 1 | -1): Polyline => {
    const pl: Polyline = [];
    for (let i = 0; i <= HYPERBOLA_SEGMENTS; i++) {
      const t = (tMax * i) / HYPERBOLA_SEGMENTS;
      const ch = a * Math.cosh(t);
      const sh = b * Math.sinh(t);
      pl.push(axis === 'x' ? { x: h + sign * ch, y: k + sh } : { x: h + sh, y: k + sign * ch });
    }
    return pl;
  };
  return { polylines: [branch(1), branch(-1)], xMin: -halfX, xMax: halfX, yMin: -halfY, yMax: halfY };
}

/** 几何方程参数化精确采样（直线两端点 / 圆/椭圆 θ 0→2π 闭合折线 / 抛物线单支 /
 *  双曲线两支）与适配视窗。aspect = 卡片高宽比（缺省 0.75 对齐默认卡片），
 *  视窗纵横比与其一致以保证等比渲染不失真（ZOO-147）。 */
export function sampleGeometry(
  kind: 'line' | 'circle' | 'ellipse' | 'parabola' | 'hyperbola',
  params: LineParams | CircleParams | EllipseParams | ParabolaParams | HyperbolaParams,
  aspect: number = DEFAULT_ASPECT,
): SampleResult {
  if (kind === 'line') return sampleLine(params as LineParams, aspect);
  if (kind === 'parabola') return sampleParabola(params as ParabolaParams, aspect);
  if (kind === 'hyperbola') return sampleHyperbola(params as HyperbolaParams, aspect);
  const rx = kind === 'circle' ? (params as CircleParams).r : (params as EllipseParams).rx;
  const ry = kind === 'circle' ? (params as CircleParams).r : (params as EllipseParams).ry;
  const { cx, cy } = params as CircleParams;
  const segments = 120;
  const polyline: Polyline = [];
  for (let i = 0; i <= segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    polyline.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  const padX = rx * 0.15 + 0.5;
  const padY = ry * 0.15 + 0.5;
  const { halfX, halfY } = aspectWindow(rx + padX, ry + padY, aspect);
  return {
    polylines: [polyline],
    xMin: cx - halfX,
    xMax: cx + halfX,
    yMin: cy - halfY,
    yMax: cy + halfY,
  };
}

/** 统一采样入口（4c 渲染管线调用）：按 ParseResult 分类分发。
 *  aspect = 卡片高宽比，几何 kind 用于生成纵横比一致的等比视窗（ZOO-147）。 */
export function sampleEquation(
  result: ParseResult,
  opts: { xMin: number; xMax: number; yMin?: number; yMax?: number; sampleCount?: number; aspect?: number },
): SampleResult {
  if (result.kind === 'error') return { error: result.message };
  if (result.kind === 'explicit') {
    return sampleExplicit(result.fn, opts, opts.sampleCount ?? DEFAULT_SAMPLE_COUNT);
  }
  return sampleGeometry(result.kind, result.params, opts.aspect ?? DEFAULT_ASPECT);
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
