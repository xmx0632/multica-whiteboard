/**
 * 微积分数学层（ZOO-189 T2）—— 导函数叠加与切线演示。
 *
 * 求导链：parse.ts 显式分支同款 body（explicitBody 单源）→ mathjs parse →
 * derivative → **simplify** → compile（复用 cache.ts 的 LRU）→ 求值函数。
 *
 * ⚠ 坑一（ZOO-186 报告 §2.1，PoC 实证）：对 derivative 的原始返回节点直接再
 * 求导会触发 mathjs/number 内部类型错误（Unexpected type of argument in
 * function multiplyNumber）——故本模块**每次求导后必 simplify**，导出的 expr
 * 恒为简化形，链式求导（derivativeOf(derivativeOf(…).expr)）天然安全。
 * ⚠ 坑二（PoC 实证）：tan 求导输出 sec(x)^2——sec/csc/cot 已扩入 parse.ts 的
 * ALLOWED_FUNCTIONS（mathjs 原生可求值），本模块产物可直接回灌解析管线。
 *
 * abs 等不可导点：导函数求值出 NaN，采样断笔规则天然处理，无特殊逻辑。
 *
 * 惰性契约：本模块零副作用、仅在被调用时求导（渲染管线 overlays 非空才进来），
 * 编译产物进 cache.ts LRU——同表达式重复叠加零成本。
 *
 * T3（ZOO-190）已追加定积分：integralOf（自适应辛普森，纯数值、不依赖求导链，
 * 与 derivativeOf / tangentOf 并列导出、互不依赖）。
 */
import { derivative, parse, simplify } from 'mathjs/number';
import { compileCached } from './cache';
import { explicitBody, parseEquation } from './parse';
import type { Polyline } from './types';
import { zhT, type LibT } from '../../i18n/lib';

/** 求导成功产物。 */
export interface DerivativeOf {
  ok: true;
  /**
   * 求值函数：scope 注入常量 + 自变量（常量先行、自变量后注入，同名时自变量
   * 优先，与 parse.ts 显式路径一致）；异常与非 number 结果一律 NaN（断笔）。
   */
  fn: (x: number) => number;
  /** 简化后的导函数表达式（缓存键成分；恒为 simplify 产物，可安全回灌求导链） */
  expr: string;
}

/** 求导失败：notExplicit = 非显式函数（几何/隐式/错误态）；unsupported = mathjs 不支持求导。 */
export type DerivativeOutcome = DerivativeOf | { ok: false; reason: 'notExplicit' | 'unsupported' };

/**
 * 求导编译缓存键前缀：cache.ts 编译缓存与方程 body 共用一张 LRU，'∂:' 不在
 * 用户输入字符白名单内（parse 前置拦截），主方程键与之无碰撞。
 */
const DERIV_CACHE_PREFIX = '∂:';

/**
 * 一阶导函数（ZOO-189 T2 惰性求导入口）。
 * 非显式函数 / 求导不支持返回 ok:false，调用方静默跳过叠加（开关数据保留）。
 */
export function derivativeOf(
  equation: string,
  opts: { constants?: Record<string, number>; t?: LibT } = {},
): DerivativeOutcome {
  const parsed = parseEquation(equation, opts.t ?? zhT, opts.constants);
  if (parsed.kind !== 'explicit') return { ok: false, reason: 'notExplicit' };
  const variable = parsed.variable ?? 'x';
  const body = explicitBody(equation);
  // 理论不可达（parseEquation 已判 explicit）；防御性兜底
  if (body === null) return { ok: false, reason: 'notExplicit' };
  try {
    const node = parse(body);
    // 坑一：derivative → simplify 固定顺序（见文件头）
    const simplified = simplify(derivative(node, variable));
    const expr = simplified.toString();
    const compiled = compileCached(DERIV_CACHE_PREFIX + expr, simplified);
    const withConstants = opts.constants && Object.keys(opts.constants).length > 0;
    const fn = (x: number): number => {
      try {
        const scope: Record<string, number> = withConstants ? { ...opts.constants } : {};
        scope[variable] = x;
        const v = compiled.evaluate(scope);
        return typeof v === 'number' ? v : NaN;
      } catch {
        return NaN;
      }
    };
    return { ok: true, fn, expr };
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
}

/** 切线演示数据（数学坐标）。 */
export interface TangentOf {
  /** 切点横坐标 */
  x0: number;
  /** 切点纵坐标 f(x₀) */
  y0: number;
  /** 斜率 f′(x₀) */
  slope: number;
  /** 切线折线（两端各越出定义域 5%，绘制层按卡片裁剪——与几何采样贯穿边缘先例一致） */
  polyline: Polyline;
}

/**
 * 切线演示（ZOO-189 T2）：f(x₀)+f′(x₀)(x−x₀) 的直线折线。
 * x₀ 越出定义域、f(x₀) / f′(x₀) 非有限（不可导点）返回 null——不绘制即可，
 * 不报错（切线是演示性叠加，输入合法但函数局部不可导属正常数学情形）。
 */
export function tangentOf(
  fn: (x: number) => number,
  dfn: (x: number) => number,
  x0: number,
  xMin: number,
  xMax: number,
): TangentOf | null {
  if (!Number.isFinite(x0) || x0 < xMin || x0 > xMax) return null;
  const y0 = fn(x0);
  const slope = dfn(x0);
  if (!Number.isFinite(y0) || !Number.isFinite(slope)) return null;
  const reach = (xMax - xMin) * 0.05 || 1;
  const xa = xMin - reach;
  const xb = xMax + reach;
  const lineY = (x: number) => y0 + slope * (x - x0);
  return { x0, y0, slope, polyline: [{ x: xa, y: lineY(xa) }, { x: xb, y: lineY(xb) }] };
}

/** 定积分产物（ZOO-190 T3）。 */
export interface IntegralOf {
  /** ∫ᵃᵇ f(x)dx（a>b 时交换端点取负——有符号面积） */
  value: number;
  /**
   * 着色区闭合折线（数学坐标）：f 在 [lo,hi] 的采样段 + 基线 y=0 两端角点
   * （末尾 (hi,0)、(lo,0)）——绘制层 closePath 成「曲线与 x 轴围成区域」。
   */
  region: Polyline;
  /** 面积 chip 锚点（数学坐标）：区间中点、f(中点)/2 高度——恒落在着色区内 */
  anchor: { x: number; y: number };
}

/**
 * 定积分失败（ZOO-190 T3）：invalid = 端点非有限或零宽（a===b）；
 * singularity = 区间内 f 存在无定义点（预扫或求积采样出 NaN/±Inf，如 ∫₋₁¹dx/x）。
 * message 为「现象 + 怎么办」双段式文案（mathErr.integral*，随注入语言）。
 */
export type IntegralOutcome =
  | ({ ok: true } & IntegralOf)
  | { ok: false; reason: 'invalid' | 'singularity'; message: string };

/**
 * 着色区采样段数（偶数——中点 (lo+hi)/2 不落在网格上，与辛普森求积点互补，
 * 一张网格同时服务预扫与折线，单次 ~130 求值）。
 */
const INTEGRAL_REGION_SEGMENTS = 128;
/** 自适应辛普森递归深度上限（2^16 段封顶——陡峭函数的最坏情形护栏）。 */
const INTEGRAL_MAX_DEPTH = 16;

/** 单段辛普森公式（三点 [a,b]，b−a 为段宽）。 */
function simpson3(a: number, b: number, fa: number, fm: number, fb: number): number {
  return ((b - a) / 6) * (fa + 4 * fm + fb);
}

/**
 * 自适应辛普森（ZOO-186 报告 §2.1 / PoC round2 同款）：二分子区间对比误差，
 * 15ε 内收敛并做 Richardson 修正（delta/15），否则对半递归（eps 减半）。
 * 光滑教学函数（sin/x²/exp）数层内收敛；深度上限护栏陡峭最坏情形。
 */
function adaptiveSimpson(
  fn: (x: number) => number,
  a: number,
  b: number,
  fa: number,
  fm: number,
  fb: number,
  whole: number,
  eps: number,
  depth: number,
): number {
  const m = (a + b) / 2;
  const lm = (a + m) / 2;
  const rm = (m + b) / 2;
  const flm = fn(lm);
  const frm = fn(rm);
  const left = simpson3(a, m, fa, flm, fm);
  const right = simpson3(m, b, fm, frm, fb);
  const delta = left + right - whole;
  if (depth <= 0 || Math.abs(delta) <= 15 * eps) return left + right + delta / 15;
  const half = eps / 2;
  return (
    adaptiveSimpson(fn, a, m, fa, flm, fm, left, half, depth - 1) +
    adaptiveSimpson(fn, m, b, fm, frm, fb, right, half, depth - 1)
  );
}

/**
 * 定积分（ZOO-190 T3）：自适应辛普森求 ∫ᵃᵇ f(x)dx + 着色区折线 + chip 锚点。
 * 奇点防护：求积前对 [a,b] 预扫采样点（与折线共用网格），任一 NaN/±Inf 即
 * 判 singularity——不产出错误区域、不崩溃（∫₋₁¹ dx/x 类区间友好报错）。
 */
export function integralOf(
  fn: (x: number) => number,
  a: number,
  b: number,
  t: LibT = zhT,
): IntegralOutcome {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(Math.abs(b - a) > 0)) {
    return { ok: false, reason: 'invalid', message: t('mathErr.integralInvalid') };
  }
  const signed = a > b ? -1 : 1; // a>b：有符号面积（∫₂¹ = −∫₁²），区域仍画 [lo,hi]
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  // 奇点预扫 + 着色折线共用一张网格（预扫见函数头注释）
  const n = INTEGRAL_REGION_SEGMENTS;
  const region: Polyline = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n;
    const y = fn(x);
    if (!Number.isFinite(y)) return { ok: false, reason: 'singularity', message: t('mathErr.integralSingularity') };
    region[i] = { x, y };
  }
  region.push({ x: hi, y: 0 }, { x: lo, y: 0 });

  const mid = (lo + hi) / 2;
  const fMid = fn(mid);
  const whole = simpson3(lo, hi, region[0].y, fMid, region[n].y);
  const value = signed * adaptiveSimpson(
    fn,
    lo,
    hi,
    region[0].y,
    fMid,
    region[n].y,
    whole,
    1e-7 * Math.max(1, Math.abs(whole)),
    INTEGRAL_MAX_DEPTH,
  );
  // 网格未命中而求积点命中的奇点（无理位置无定义点）：结果非有限 → 同口径报错
  if (!Number.isFinite(value)) return { ok: false, reason: 'singularity', message: t('mathErr.integralSingularity') };
  return { ok: true, value, region, anchor: { x: mid, y: fMid / 2 } };
}
