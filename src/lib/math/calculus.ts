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
 * T3（定积分）将在本文件追加自适应辛普森：求导相关导出收敛于独立命名
 * （derivativeOf / tangentOf），与积分实现互不依赖，留出并列空间。
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
