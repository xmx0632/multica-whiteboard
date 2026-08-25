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
  DegeneratePointParams,
  EllipseParams,
  HyperbolaParams,
  LineParams,
  LinePairParams,
  MathViewport,
  ParabolaParams,
  ParseResult,
  Polyline,
  PreviewData,
  StructuralOutcome,
} from './types';
import { zhT, type LibT } from '../../i18n/lib';

/** 采样数硬上限（PRD §8 / PM 硬约束，UI 不暴露超限入口，sample 内 clamp）。 */
export const MAX_SAMPLE_COUNT = 2000;
/** 默认采样档位（交互基线：粗 160 / 中 320 / 细 640）。 */
export const DEFAULT_SAMPLE_COUNT = 320;
/**
 * 定义域宽度合法区间。下限导出供高级公式「×10 邻域放大」预设（ZOO-193 T6）
 * 对齐——预设连续点击的收窄地板即采样层合法下限，不会把域压进报错区间。
 */
export const MIN_DOMAIN_WIDTH = 0.1;
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
 *
 * ZOO-206 修复：数据自身贴近 0（距 0 不超过其正向幅度的 10%）时把视窗扩展
 * 到含 0 并留 8% 边距——保证横轴与原点可见（y=√x 原点起笔、曲线过原点可
 * 检验）。此前四分位拟合会把单侧值域函数（√x 的 [0.53,3.96]）的 0 挤出视窗，
 * 横轴整条不可见、原点无从谈起。远离 0 的函数（y=x²+100，数据最小 100）不
 * 受影响，仍保持数据居中视窗。参数式 / 极坐标的 xy 双向拟合复用本函数，同
 * 口径受益。
 */
function fitYWindow(finiteYs: number[]): { min: number; max: number } {
  const sorted = [...finiteYs].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const med = percentile(sorted, 0.5);
  const q3 = percentile(sorted, 0.75);
  let spread = 1.5 * (q3 - q1);
  if (!(spread > 1e-9)) spread = Math.max(Math.abs(med) * 0.5, 1);
  let min = med - spread;
  let max = med + spread;
  const dataMin = sorted[0];
  const dataMax = sorted[sorted.length - 1];
  if (min > 0 && dataMin <= 0.1 * dataMax) min = -0.08 * max;
  else if (max < 0 && dataMax >= 0.1 * dataMin) max = -0.08 * min;
  return { min, max };
}

/**
 * 多序列显式采样结果（ZOO-189 T2）：每序列独立断笔折线，共用同一最终 y 视窗。
 */
export type MultiSampleResult =
  | { series: Polyline[][]; yMin: number; yMax: number; xMin: number; xMax: number }
  | { error: string };

/**
 * 多序列显式采样（ZOO-189 T2）：f 与 f′ 叠加时共用同一 y 视窗——**各序列独立
 * 四分位自适应后取窗口并集**（每条曲线至少获得其单独渲染时的视窗，互不挤出；
 * 不对合并点集拟合——集中分布的序列会把另一序列的摆幅当尾部裁掉），断笔对每
 * 序列独立判定、使用同一最终视窗。单序列时与 sampleExplicit 既有行为一致
 * （后者即本函数的单函数退化封装）。
 *
 * @param fns      求值函数列表（parseEquation / derivativeOf 产物，异常返回 NaN）
 * @param view     x 定义域必填；y 视窗可选 —— 省略或非法时按各序列自适应取并集
 * @param count    采样点数（内部 clamp 到 [2, 2000]，各序列同批 x 采样）
 */
export function sampleExplicitMulti(
  fns: readonly ((x: number) => number)[],
  view: Pick<MathViewport, 'xMin' | 'xMax'> & Partial<Pick<MathViewport, 'yMin' | 'yMax'>>,
  count: number,
  t: LibT = zhT,
): MultiSampleResult {
  const { xMin, xMax } = view;
  if (!(xMin < xMax)) return { error: t('mathErr.domainOrder') };
  const width = xMax - xMin;
  if (width < MIN_DOMAIN_WIDTH - 1e-12 || width > MAX_DOMAIN_WIDTH + 1e-12) {
    return { error: t('mathErr.domainWidth') };
  }

  const n = clampSampleCount(count);
  const xs = new Array<number>(n);
  for (let i = 0; i < n; i++) xs[i] = xMin + (width * i) / (n - 1);
  const rows = fns.map((fn) => {
    const ys = new Array<number>(n);
    for (let i = 0; i < n; i++) ys[i] = fn(xs[i]);
    return ys;
  });
  if (rows.every((ys) => ys.every((y) => !Number.isFinite(y)))) {
    // ZOO-166：附「怎么办」指引（调整定义域或检查表达式）
    return { error: t('mathErr.noValidValues') };
  }

  // 各序列独立稳健拟合 → 取窗口并集（min of mins / max of maxes）
  let autoMin = Infinity;
  let autoMax = -Infinity;
  for (const ys of rows) {
    const finiteYs = ys.filter((y) => Number.isFinite(y));
    if (finiteYs.length === 0) continue; // 全 NaN 序列不参与（如 abs 在窄域外的导数）
    const fit = fitYWindow(finiteYs);
    autoMin = Math.min(autoMin, fit.min);
    autoMax = Math.max(autoMax, fit.max);
  }
  const yMin = view.yMin !== undefined && view.yMax !== undefined && view.yMin < view.yMax ? view.yMin : autoMin;
  const yMax = view.yMin !== undefined && view.yMax !== undefined && view.yMin < view.yMax ? view.yMax : autoMax;
  const span = yMax - yMin;

  const series = rows.map((ys) => {
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
    return polylines;
  });
  return { series, yMin, yMax, xMin, xMax };
}

/**
 * 分段多序列采样（ZOO-216）：sampleExplicitMulti 的分段增强版，两条分段专属
 * 规则（评审方案「采样断笔」）：
 *
 * 1. **折点精确**：条件常数边界（breakpoints）并入采样网格——熔化平台端点、
 *    计费折点恰好落在分段点上，不随网格相位漂移（折点不粘连）。
 * 2. **跳跃断笔无伪竖线**：对每序列在每个边界 b 以 b±δ 一侧极限探测跳变
 *    （|F(b−δ)−F(b+δ)| 超相对阈值即跳跃间断）——发生跳跃时按 F(b) 与两侧
 *    极限的远近判定 b 点归属（靠近左极限归左支、断在其后；反之断在其前），
 *    两侧折线在 b 处断开、不画竖直连线。连续折点（如熔化曲线 t=2 处
 *    5t−10→0 平滑衔接）两侧极限相等，不断笔、折线连通成教材折线形态。
 *    f′ 序列同规则受益：连续但不可导的折点处导数发生跳跃（5→0），f′ 在该
 *    处断笔——「分段点不可导按 NaN 断笔」的可见呈现（abs 先例同口径）。
 *
 * 既有渐近线断笔（越窗双向大跳）与 NaN 断笔照常；条件间隙（无段命中）求值
 * NaN 自然断笔（无定义区间的正确语义，评审边缘场景 6）。
 */
export function samplePiecewiseMulti(
  fns: readonly ((x: number) => number)[],
  breakpoints: readonly number[],
  view: Pick<MathViewport, 'xMin' | 'xMax'> & Partial<Pick<MathViewport, 'yMin' | 'yMax'>>,
  count: number,
  t: LibT = zhT,
): MultiSampleResult {
  const { xMin, xMax } = view;
  if (!(xMin < xMax)) return { error: t('mathErr.domainOrder') };
  const width = xMax - xMin;
  if (width < MIN_DOMAIN_WIDTH - 1e-12 || width > MAX_DOMAIN_WIDTH + 1e-12) {
    return { error: t('mathErr.domainWidth') };
  }

  const n = clampSampleCount(count);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(xMin + (width * i) / (n - 1));
  for (const b of breakpoints) {
    if (Number.isFinite(b) && b > xMin && b < xMax) xs.push(b);
  }
  xs.sort((a, b) => a - b);
  const grid: number[] = [];
  for (const x of xs) {
    if (grid.length === 0 || x - grid[grid.length - 1] > 1e-9 * (1 + Math.abs(x))) grid.push(x);
  }

  const rows = fns.map((fn) => grid.map((x) => fn(x)));
  if (rows.every((ys) => ys.every((y) => !Number.isFinite(y)))) {
    return { error: t('mathErr.noValidValues') };
  }

  // 各序列独立稳健拟合 → 取窗口并集（口径同 sampleExplicitMulti）
  let autoMin = Infinity;
  let autoMax = -Infinity;
  for (const ys of rows) {
    const finiteYs = ys.filter((y) => Number.isFinite(y));
    if (finiteYs.length === 0) continue;
    const fit = fitYWindow(finiteYs);
    autoMin = Math.min(autoMin, fit.min);
    autoMax = Math.max(autoMax, fit.max);
  }
  const yMin = view.yMin !== undefined && view.yMax !== undefined && view.yMin < view.yMax ? view.yMin : autoMin;
  const yMax = view.yMin !== undefined && view.yMax !== undefined && view.yMin < view.yMax ? view.yMax : autoMax;
  const span = yMax - yMin;

  // 跳跃边界的逐序列判定：一侧极限探测 + b 点归属（见函数头注释第 2 条）。
  // δ 与阈值的配比：线性段在 b±δ 的探测值带 slope·δ 的系统性偏差（连续折点
  // 两侧读数差 ≈ 斜率·2δ），阈值须吞掉该抹平量、又远小于真实跳跃——取
  // δ = 宽度·10⁻⁹、阈值 = 10⁻⁶·(1+|两侧|)，中间隔三个数量级。
  const delta = Math.max(1e-12, width * 1e-9);
  const edges: Array<{ x: number; breakAfter: boolean }[]> = fns.map((fn) => {
    const list: Array<{ x: number; breakAfter: boolean }> = [];
    for (const b of breakpoints) {
      if (!(b > xMin && b < xMax)) continue;
      const fl = fn(b - delta);
      const fr = fn(b + delta);
      if (!Number.isFinite(fl) || !Number.isFinite(fr)) continue;
      if (Math.abs(fl - fr) <= 1e-6 * (1 + Math.abs(fl) + Math.abs(fr))) continue; // 连续折点：连通
      const fb = fn(b);
      if (!Number.isFinite(fb)) continue; // b 无定义：NaN 断笔已覆盖
      list.push({ x: b, breakAfter: Math.abs(fb - fl) <= Math.abs(fb - fr) });
    }
    return list;
  });

  const series = rows.map((ys, k) => {
    const polylines: Polyline[] = [];
    let current: Polyline = [];
    const breakHere = () => {
      if (current.length > 0) polylines.push(current);
      current = [];
    };
    for (let i = 0; i < grid.length; i++) {
      const x = grid[i];
      const y = ys[i];
      if (!Number.isFinite(y)) {
        breakHere();
        continue;
      }
      if (current.length > 0) {
        const prevX = current[current.length - 1].x;
        const prevY = current[current.length - 1].y;
        const jumpsAcrossWindow =
          span > 0 && ((prevY > yMax && y < yMin) || (y > yMax && prevY < yMin));
        if (jumpsAcrossWindow && Math.abs(y - prevY) > span) breakHere();
        else {
          for (const e of edges[k]) {
            // breakAfter：b 点归左支，断在 b 与下一点之间；否则断在上一点与 b 之间
            if ((e.breakAfter && prevX <= e.x && x > e.x) || (!e.breakAfter && prevX < e.x && x >= e.x)) {
              breakHere();
              break;
            }
          }
        }
      }
      current.push({ x, y });
    }
    breakHere();
    return polylines;
  });
  return { series, yMin, yMax, xMin, xMax };
}

/**
 * 显式函数采样（sampleExplicitMulti 的单函数封装，行为与历史逐字节一致）。
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
  t: LibT = zhT,
): SampleResult {
  const r = sampleExplicitMulti([fn], view, count, t);
  if ('error' in r) return r;
  const { series, ...rest } = r;
  return { polylines: series[0], ...rest };
}

/** 直线视窗基准半径（数学单位）：原点居中视窗的最小半宽，量级对齐显式默认域 ±10。 */
const LINE_VIEW_BASE = 8;

/** 几何视窗默认纵横比（数学单位 y 跨度 / x 跨度）：对齐默认卡片 480×360。 */
const DEFAULT_ASPECT = 0.75;

/**
 * 参数式 / 极坐标默认参数域 [0, 2π]（ZOO-191 T4）：参数圆 / 心形线 / 李萨如
 * 的整周期；摆线默认域出一段完整拱。元素 xAxis 字段复用为 t/θ 域。
 */
export const DEFAULT_PARAMETER_DOMAIN = { min: 0, max: Math.PI * 2 } as const;

/**
 * 参数式采样（ZOO-191 T4）：t 均匀采样 → (fx(t), fy(t)) 数学坐标折线。
 * 断笔：x/y 任一非有限断笔；相邻点距超过视窗对角线 2 倍判为渐近线跳变断笔
 * （对角线判据尺度无关——陡峭单调段〔Δy 大 Δx 小〕不会误杀，sec/tan 类
 * 渐近线两侧的双向大跳会被截断）。
 * 视窗：**xy 双向**四分位自适应（fitYWindow 的分位数逻辑与轴无关，x/y 独立
 * 拟合后取中位数为中心），再经 aspectWindow 与卡片纵横比对齐（圆不画成椭圆）。
 */
export function sampleParametric(
  fx: (t: number) => number,
  fy: (t: number) => number,
  view: Pick<MathViewport, 'xMin' | 'xMax'>,
  count: number,
  aspect: number = DEFAULT_ASPECT,
  t: LibT = zhT,
): SampleResult {
  const { xMin: tMin, xMax: tMax } = view;
  if (!(tMin < tMax)) return { error: t('mathErr.domainOrder') };
  const width = tMax - tMin;
  if (width < MIN_DOMAIN_WIDTH - 1e-12 || width > MAX_DOMAIN_WIDTH + 1e-12) {
    return { error: t('mathErr.domainWidth') };
  }

  const n = clampSampleCount(count);
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  let anyFinite = false;
  for (let i = 0; i < n; i++) {
    const tv = tMin + (width * i) / (n - 1);
    const x = fx(tv);
    const y = fy(tv);
    const finite = Number.isFinite(x) && Number.isFinite(y);
    xs[i] = finite ? (x as number) : NaN;
    ys[i] = finite ? (y as number) : NaN;
    if (finite) anyFinite = true;
  }
  if (!anyFinite) return { error: t('mathErr.noValidValues') };

  // xy 双向稳健拟合（分位数与轴无关，fitYWindow 直接复用于 x 轴）
  const finiteXs = xs.filter((x) => Number.isFinite(x));
  const finiteYs = ys.filter((y) => Number.isFinite(y));
  const xFit = fitYWindow(finiteXs);
  const yFit = fitYWindow(finiteYs);
  const cx = (xFit.min + xFit.max) / 2;
  const cy = (yFit.min + yFit.max) / 2;
  // 数据视窗外扩 15% + 0.5 内边距后与卡片纵横比对齐（直线视窗同款余量）
  const { halfX, halfY } = aspectWindow(((xFit.max - xFit.min) / 2) * 1.15 + 0.5, ((yFit.max - yFit.min) / 2) * 1.15 + 0.5, aspect);
  const xMinV = cx - halfX;
  const xMaxV = cx + halfX;
  const yMinV = cy - halfY;
  const yMaxV = cy + halfY;
  const diag = Math.hypot(xMaxV - xMinV, yMaxV - yMinV);

  const polylines: Polyline[] = [];
  let current: Polyline = [];
  const breakHere = () => {
    if (current.length > 0) polylines.push(current);
    current = [];
  };
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      breakHere();
      continue;
    }
    if (current.length > 0) {
      const prev = current[current.length - 1];
      if (Math.hypot(x - prev.x, y - prev.y) > 2 * diag) breakHere(); // 渐近线跳变
    }
    current.push({ x, y });
  }
  breakHere();
  return { polylines, xMin: xMinV, xMax: xMaxV, yMin: yMinV, yMax: yMaxV };
}

/**
 * 极坐标采样（ZOO-191 T4）：r(θ) → (r·cosθ, r·sinθ) 的参数式退化封装
 * （断笔 / 视窗 / 域校验全部复用 sampleParametric；r 非有限或 r·cosθ 溢出
 * 均按非有限点断笔）。负 r 经 cos/sin 自然映射（点关于原点对称，标准行为）。
 */
export function samplePolar(
  rFn: (theta: number) => number,
  view: Pick<MathViewport, 'xMin' | 'xMax'>,
  count: number,
  aspect: number = DEFAULT_ASPECT,
  t: LibT = zhT,
): SampleResult {
  return sampleParametric(
    (theta) => {
      const r = rFn(theta);
      return Number.isFinite(r) ? r * Math.cos(theta) : NaN;
    },
    (theta) => {
      const r = rFn(theta);
      return Number.isFinite(r) ? r * Math.sin(theta) : NaN;
    },
    view,
    count,
    aspect,
    t,
  );
}

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
 * 直线视窗基准半宽（数学单位）：原点居中视窗的最小半宽，量级对齐显式默认域 ±10；
 * 纳入离原点最近点与两轴截距（linePair 共用，ZOO-148）。
 */
function lineWindowBase(a: number, b: number, c: number): number {
  const denom = a * a + b * b;
  const xIntercept = a !== 0 && Number.isFinite(c / a) ? Math.abs(c / a) : 0;
  const yIntercept = b !== 0 && Number.isFinite(c / b) ? Math.abs(c / b) : 0;
  return Math.max(LINE_VIEW_BASE, Math.abs((a * c) / denom), Math.abs((b * c) / denom), xIntercept, yIntercept);
}

/** 直线采样折线：离原点最近点 P₀ 沿方向向量 (b,−a) 两端各延伸 r（越出卡片裁剪）。 */
function linePolyline(a: number, b: number, c: number, r: number): Polyline {
  const denom = a * a + b * b;
  const norm = Math.sqrt(denom);
  const p0x = (a * c) / denom;
  const p0y = (b * c) / denom;
  const dx = b / norm;
  const dy = -a / norm;
  return [
    { x: p0x - r * dx, y: p0y - r * dy },
    { x: p0x + r * dx, y: p0y + r * dy },
  ];
}

/**
 * 直线参数化采样（D7 方案 A / 研究报告 §2.3）：直线无自然定义域，
 * 视窗取原点居中（保证坐标轴上下文可见），半宽纳入离原点最近点 P₀ 与两轴
 * 截距；采样折线沿方向向量 (b,−a) 越出视窗对角（两端各 2×最大半宽），
 * 绘制层按卡片矩形天然裁剪——平移缩放不重采样承诺不受影响。
 */
function sampleLine(params: LineParams, aspect: number, t: LibT = zhT): SampleResult {
  const { a, b, c } = params;
  if (a === 0 && b === 0) return { error: t('mathErr.notALine') };
  const base = lineWindowBase(a, b, c);
  const { halfX, halfY } = aspectWindow(base * 1.15 + 0.5, base * 1.15 + 0.5, aspect); // 15% + 0.5 内边距
  const r = 2 * Math.max(halfX, halfY); // 采样半径：必越出视窗对角线，卡片裁剪后两端不缺角
  return { polylines: [linePolyline(a, b, c, r)], xMin: -halfX, xMax: halfX, yMin: -halfY, yMax: halfY };
}

/**
 * 退化直线对采样（ZOO-148 / 研究报告 §3.2「复用 line 全部设施」）：两线共用
 * 同一原点居中视窗（基准半宽取两线锚点的较大者，网格 / 轴上下文一致），
 * 各产出一条贯穿折线；重合直线退化为单线。
 */
function sampleLinePair(params: LinePairParams, aspect: number, t: LibT = zhT): SampleResult {
  if (params.lines.some((l) => l.a === 0 && l.b === 0)) return { error: t('mathErr.notALine') };
  const base = Math.max(...params.lines.map((l) => lineWindowBase(l.a, l.b, l.c)));
  const { halfX, halfY } = aspectWindow(base * 1.15 + 0.5, base * 1.15 + 0.5, aspect);
  const r = 2 * Math.max(halfX, halfY);
  return {
    polylines: params.lines.map((l) => linePolyline(l.a, l.b, l.c, r)),
    xMin: -halfX,
    xMax: halfX,
    yMin: -halfY,
    yMax: halfY,
  };
}

/** 退化单点标记半径下限（数学单位）：视窗半宽 ×2%，保证默认视窗下可见的小圆点。 */
const POINT_MARKER_MIN_R = 0.1;

/**
 * 退化单点采样（ZOO-148 / 研究报告 §3.2「极小标记点」）：点本身无尺寸，采样为
 * 半径 = 视窗半宽 2%（下限 0.1）的小圆折线——恒可见且随元素整体缩放；视窗原点
 * 居中、纳入点与 2 单位余量（坐标轴上下文可见，与 line 先例一致）。
 */
function samplePoint(params: DegeneratePointParams, aspect: number): SampleResult {
  const { x, y } = params;
  const { halfX, halfY } = aspectWindow(Math.max(5, Math.abs(x) + 2), Math.max(5, Math.abs(y) + 2), aspect);
  const r = Math.max(POINT_MARKER_MIN_R, 0.02 * Math.min(halfX, halfY));
  const polyline: Polyline = [];
  const segments = 28;
  for (let i = 0; i <= segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    polyline.push({ x: x + r * Math.cos(t), y: y + r * Math.sin(t) });
  }
  return { polylines: [polyline], xMin: -halfX, xMax: halfX, yMin: -halfY, yMax: halfY };
}

/**
 * 抛物线参数化采样（ZOO-147 / D7；ZOO-149 旋转形）：轴对齐 (y−k)²=4p(x−h)
 * （axis='x'）取参 y=k+t、x=h+t²/(4p)（axis='y' 对换）——单支连续曲线，t 对称
 * 采样；旋转形对称轴单位向量 e₁（角 rotation）、垂直 e₂，参数化
 * P(t) = V + (t²/4p)·e₁ + t·e₂。视窗原点居中、纳入顶点/焦点与一段张口
 * （深度 max(4, 3|p|)）；t 上限取「越出上下边」与「越出开口侧边」所需者的
 * 较大值（旋转形按对角线放宽），卡片裁剪。
 */
function sampleParabola(params: ParabolaParams, aspect: number, t: LibT = zhT): SampleResult {
  const { h, k, p, axis } = params;
  const phi = params.rotation ?? 0;
  if (!(Math.abs(p) > 1e-12)) return { error: t('mathErr.notAParabola') };
  const depth = Math.max(4, 3 * Math.abs(p)); // 沿开口轴的展示深度
  const spread = Math.sqrt(4 * Math.abs(p) * depth); // 该深度处的张口半宽
  const anchor = Math.abs(p) + 1.5; // 焦点可见余量
  if (Math.abs(phi) > 1e-12) {
    const e1x = Math.cos(phi);
    const e1y = Math.sin(phi);
    const e2x = -e1y;
    const e2y = e1x;
    // 卡片需容纳：顶点 + 开口深度（沿 e₁）+ 张口（沿 e₂），按 x/y 分量并列求和（保守）
    const needX = Math.max(LINE_VIEW_BASE, Math.abs(h) + depth * Math.abs(e1x) + spread * Math.abs(e2x) + 1);
    const needY = Math.max(6, Math.abs(k) + depth * Math.abs(e1y) + spread * Math.abs(e2y) + 1);
    const { halfX, halfY } = aspectWindow(needX, needY, aspect);
    const reach = 1.15 * (Math.hypot(halfX, halfY) + Math.abs(h) + Math.abs(k)); // 对角线越出半径
    const tMax = Math.max(reach, Math.sqrt(4 * Math.abs(p) * reach));
    const n = 200;
    const polyline: Polyline = [];
    for (let i = 0; i <= n; i++) {
      const t = -tMax + (2 * tMax * i) / n;
      const s = (t * t) / (4 * p);
      polyline.push({ x: h + s * e1x + t * e2x, y: k + s * e1y + t * e2y });
    }
    return { polylines: [polyline], xMin: -halfX, xMax: halfX, yMin: -halfY, yMax: halfY };
  }
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
 * 双曲线参数化采样（ZOO-147 / D7；ZOO-149 旋转 + 上/下臂修复）：轴对齐
 * axis='x' 两支 (h±a·cosh t, k+b·sinh t)（axis='y' 对换）；旋转形实轴单位
 * 向量 e₁（角 rotation）、虚轴 e₂ ⊥ e₁，顶点 ±a 沿 e₁。视窗原点居中、纳入
 * 中心/顶点/焦点（R=max(a,b,c) 放余量）；t 对称取 ±tMax——**整支**双曲线
 * 需 t∈(−∞,∞)（sinh 为奇函数，只取 t≥0 会丢两支的下半臂，ZOO-149 前的
 * 既有缺陷）；tMax 使 a·cosh t、b·sinh t 越出卡片对角线（旋转形 e₁/e₂ 在
 * x/y 两轴均有分量，统一按对角线放宽 2 倍余量），卡片裁剪贯穿边缘。
 */
function sampleHyperbola(params: HyperbolaParams, aspect: number, t: LibT = zhT): SampleResult {
  const { h, k, a, b, axis } = params;
  const phi = params.rotation ?? 0;
  if (!(a > 0) || !(b > 0)) return { error: t('mathErr.notAHyperbola') };
  const c = Math.hypot(a, b);
  const r = Math.max(a, b, c);
  const { halfX, halfY } = aspectWindow(Math.max(LINE_VIEW_BASE, Math.abs(h) + 1.4 * r), Math.max(6, Math.abs(k) + 1.2 * r), aspect);
  const rotated = Math.abs(phi) > 1e-12;
  const e1x = rotated ? Math.cos(phi) : axis === 'x' ? 1 : 0;
  const e1y = rotated ? Math.sin(phi) : axis === 'x' ? 0 : 1;
  const e2x = -e1y;
  const e2y = e1x;
  // t 上限：越出卡片（轴对齐按轴向 1.15–1.25 倍；旋转按对角线 2 倍——cosh·a 与
  // sinh·b 均需足以在对角方向越出，√(m²−1)≈m 的亏量由 2 倍余量覆盖）
  const m = rotated
    ? Math.max((2 * (Math.hypot(halfX, halfY) + Math.abs(h) + Math.abs(k))) / Math.min(a, b), 1.000001)
    : Math.max((1.25 * (halfX + Math.abs(h))) / a, (1.15 * (halfY + Math.abs(k))) / b, 1.000001);
  const tMax = Math.log(m + Math.sqrt(m * m - 1)); // arcosh
  const branch = (sign: 1 | -1): Polyline => {
    const pl: Polyline = [];
    for (let i = 0; i <= HYPERBOLA_SEGMENTS; i++) {
      const t = -tMax + (2 * tMax * i) / HYPERBOLA_SEGMENTS;
      const ch = sign * a * Math.cosh(t);
      const sh = b * Math.sinh(t);
      pl.push(rotated ? { x: h + ch * e1x + sh * e2x, y: k + ch * e1y + sh * e2y } : axis === 'x' ? { x: h + ch, y: k + sh } : { x: h + sh, y: k + ch });
    }
    return pl;
  };
  return { polylines: [branch(1), branch(-1)], xMin: -halfX, xMax: halfX, yMin: -halfY, yMax: halfY };
}

/** 几何方程参数化精确采样（直线两端点 / 退化直线对两线 / 退化单点小圆标记 /
 *  圆/椭圆 θ 0→2π 闭合折线〔椭圆含旋转，ZOO-149〕 / 抛物线单支 / 双曲线两支）
 *  与适配视窗。aspect = 卡片高宽比（缺省 0.75 对齐默认卡片），视窗纵横比与其
 *  一致以保证等比渲染不失真（ZOO-147）。 */
export function sampleGeometry(
  kind: 'line' | 'linePair' | 'point' | 'circle' | 'ellipse' | 'parabola' | 'hyperbola',
  params: LineParams | LinePairParams | DegeneratePointParams | CircleParams | EllipseParams | ParabolaParams | HyperbolaParams,
  aspect: number = DEFAULT_ASPECT,
  t: LibT = zhT,
): SampleResult {
  if (kind === 'line') return sampleLine(params as LineParams, aspect, t);
  if (kind === 'linePair') return sampleLinePair(params as LinePairParams, aspect, t);
  if (kind === 'point') return samplePoint(params as DegeneratePointParams, aspect);
  if (kind === 'parabola') return sampleParabola(params as ParabolaParams, aspect, t);
  if (kind === 'hyperbola') return sampleHyperbola(params as HyperbolaParams, aspect, t);
  const isCircle = kind === 'circle';
  const rx = isCircle ? (params as CircleParams).r : (params as EllipseParams).rx;
  const ry = isCircle ? (params as CircleParams).r : (params as EllipseParams).ry;
  const phi = isCircle ? 0 : (params as EllipseParams).rotation ?? 0;
  const { cx, cy } = params as CircleParams;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const segments = 120;
  const polyline: Polyline = [];
  for (let i = 0; i <= segments; i++) {
    const ang = (2 * Math.PI * i) / segments;
    const ox = rx * Math.cos(ang);
    const oy = ry * Math.sin(ang);
    polyline.push({ x: cx + ox * cos - oy * sin, y: cy + ox * sin + oy * cos });
  }
  const padX = rx * 0.15 + 0.5;
  const padY = ry * 0.15 + 0.5;
  // 旋转椭圆包围盒：轴向端点旋转后的 x/y 投影极值（rotation=0 时退化为 rx/ry）
  const needX = Math.hypot(rx * Math.abs(cos), ry * Math.abs(sin)) + padX;
  const needY = Math.hypot(rx * Math.abs(sin), ry * Math.abs(cos)) + padY;
  const { halfX, halfY } = aspectWindow(needX, needY, aspect);
  return {
    polylines: [polyline],
    xMin: cx - halfX,
    xMax: cx + halfX,
    yMin: cy - halfY,
    yMax: cy + halfY,
  };
}

/** 统一采样入口（4c 渲染管线调用）：按 ParseResult 分类分发。
 *  aspect = 卡片高宽比，几何 kind 用于生成纵横比一致的等比视窗（ZOO-147）。
 *  ZOO-191（T4）：parametric / polar 走参数域采样——opts.xMin/xMax 即 t/θ 域
 *  （元素 xAxis 字段复用），视窗由数据 xy 双向自适应（忽略传入的 y 视窗）。 */
export function sampleEquation(
  result: ParseResult,
  opts: { xMin: number; xMax: number; yMin?: number; yMax?: number; sampleCount?: number; aspect?: number },
  t: LibT = zhT,
): SampleResult {
  if (result.kind === 'error') return { error: result.message };
  if (result.kind === 'explicit') {
    return sampleExplicit(result.fn, opts, opts.sampleCount ?? DEFAULT_SAMPLE_COUNT, t);
  }
  if (result.kind === 'piecewise') {
    // 分段采样（ZOO-216）：折点并入网格 + 跳跃断笔（见 samplePiecewiseMulti）
    const r = samplePiecewiseMulti([result.fn], result.breakpoints, opts, opts.sampleCount ?? DEFAULT_SAMPLE_COUNT, t);
    if ('error' in r) return r;
    const { series, ...rest } = r;
    return { polylines: series[0], ...rest };
  }
  if (result.kind === 'parametric') {
    return sampleParametric(result.fx, result.fy, opts, opts.sampleCount ?? DEFAULT_SAMPLE_COUNT, opts.aspect ?? DEFAULT_ASPECT, t);
  }
  if (result.kind === 'polar') {
    return samplePolar(result.fn, opts, opts.sampleCount ?? DEFAULT_SAMPLE_COUNT, opts.aspect ?? DEFAULT_ASPECT, t);
  }
  return sampleGeometry(result.kind, result.params, opts.aspect ?? DEFAULT_ASPECT, t);
}

/**
 * 编辑器实时预览适配（EquationEditor 的 createPreviewPolylines 注入点实现）。
 * 显式函数用默认视窗 x∈[-10,10] + y 自适应；几何方程用参数化包围盒。
 * 返回 null 表示不出曲线（错误态 / 解析失败），预览仅显示坐标系或错误文案。
 * ZOO-188（T1）：constants 透传 parseEquation——含符号常量的公式（y=A·sin(ωx+φ)）
 * 绑定常量后预览实时出曲线。
 * ZOO-191（T4）：parametric / polar 预览用默认参数域 [0,2π]（四类模板的整周期）。
 * ZOO-192（T5）：domain 透传草稿 t/θ 域（物理模板预置落地时间等）——缺省 /
 * 非法（倒序 / 非有限）回落默认 [0,2π]，注入方无需预校验。
 * ZOO-213：显式函数同样吃 domain（学段模板的自变量定义域预置——预览窗口
 * 与插入后元素 xAxis 一致）；缺省 / 非法回落默认 ±10。
 */
export function createPreviewPolylines(
  equation: string,
  outcome: StructuralOutcome | ParseResult,
  constants?: Record<string, number>,
  domain?: { min: number; max: number },
): PreviewData | null {
  if (outcome.kind === 'error') return null;
  if (outcome.kind === 'parametric' || outcome.kind === 'polar') {
    const parsed = parseEquation(equation, zhT, constants);
    if (parsed.kind !== 'parametric' && parsed.kind !== 'polar') return null;
    const dom =
      domain !== undefined && Number.isFinite(domain.min) && Number.isFinite(domain.max) && domain.min < domain.max
        ? domain
        : { min: DEFAULT_PARAMETER_DOMAIN.min, max: DEFAULT_PARAMETER_DOMAIN.max };
    const sampled = sampleEquation(parsed, { xMin: dom.min, xMax: dom.max, sampleCount: DEFAULT_SAMPLE_COUNT });
    if ('error' in sampled) return null;
    return { polylines: sampled.polylines, xMin: sampled.xMin, xMax: sampled.xMax, yMin: sampled.yMin, yMax: sampled.yMax };
  }
  if (outcome.kind !== 'explicit' && outcome.kind !== 'piecewise') {
    const sampled = sampleGeometry(outcome.kind, outcome.params);
    if ('error' in sampled) return null;
    return { polylines: sampled.polylines, xMin: sampled.xMin, xMax: sampled.xMax, yMin: sampled.yMin, yMax: sampled.yMax };
  }
  const parsed = parseEquation(equation, zhT, constants);
  if (parsed.kind !== 'explicit' && parsed.kind !== 'piecewise') return null;
  // ZOO-213：显式函数的域草稿（学段模板的自变量定义域预置）参与采样——
  // 预览窗口与插入后的元素 xAxis 一致；缺省 / 非法回落默认 ±10。
  // ZOO-216：piecewise 走 sampleEquation 分发（折点并入网格 + 跳跃断笔）。
  const dom =
    domain !== undefined && Number.isFinite(domain.min) && Number.isFinite(domain.max) && domain.min < domain.max
      ? domain
      : { min: -10, max: 10 };
  const sampled = sampleEquation(parsed, { xMin: dom.min, xMax: dom.max, sampleCount: DEFAULT_SAMPLE_COUNT });
  if ('error' in sampled) return null;
  return { polylines: sampled.polylines, xMin: dom.min, xMax: dom.max, yMin: sampled.yMin, yMax: sampled.yMax };
}
