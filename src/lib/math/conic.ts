/**
 * 隐式二元方程分类器（ZOO-146，设计文档 D7 / 可行性研究 §2–§3「数值探针」路线）。
 *
 * 纯函数层：不 import mathjs —— 安全求值器 F(x,y) 由 parse.ts 的隐式分支
 * （顶层 split `=` → F=lhs−rhs → AST 白名单 + compile，scope 含 x/y）注入，
 * 故本模块可脱离 mathjs 独立单测。P0 交付二元一次 → kind='line'（含竖线）；
 * 二次探针与非线性出口为 ZOO-147（抛物线/双曲线）/ ZOO-148（退化形）预留骨架。
 *
 * 线性探针（研究报告 §2.1，mathjs 不能 parse 裸等式，故顶层 `=` 手工 split）：
 *   a = F(1,0)−F(0,0)   b = F(0,1)−F(0,0)   c = −F(0,0)
 * 输入形态无关：`2(x+y)=3x−4`、`x/2−y=1`、变序 `6=3x+2y` 等等价书写全部命中。
 */
import type { LineParams } from './types';

/** F(x,y) 安全求值器（求值异常 / 非 number 一律 NaN，与 explicit 求值函数同约定）。 */
export type BinaryFn = (x: number, y: number) => number;

/**
 * 括号深度 0 处切分顶层 `=`：恰一个等号返回两侧；零个 / 多个 / 某侧为空返回 null。
 * 归一化产物不含比较运算符，`=` 只可能是等号（`==` 视为两个顶层等号 → null）。
 */
export function splitTopLevelEquals(src: string): { lhs: string; rhs: string } | null {
  let depth = 0;
  let top = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '=' && depth === 0) {
      if (top >= 0) return null;
      top = i;
    }
  }
  if (depth !== 0 || top < 0) return null;
  const lhs = src.slice(0, top);
  const rhs = src.slice(top + 1);
  if (!lhs || !rhs) return null;
  return { lhs, rhs };
}

/** 构造 F 表达式串 `(lhs)-(rhs)`（括号包裹防移项运算优先级错位；parse 由调用方执行）。 */
export function buildImplicitExpression(lhs: string, rhs: string): string {
  return `(${lhs})-(${rhs})`;
}

/** 线性 3 点探针：F(x,y)=ax+by−c 时三次求值精确恢复系数。 */
export function probeLinear(f: BinaryFn): LineParams {
  const f0 = f(0, 0);
  return { a: f(1, 0) - f0, b: f(0, 1) - f0, c: -f0 };
}

/**
 * 线性校验（风险 R1 相对容差）：校验点取 (2,3) 与 (−2,−3)——正负象限各一，
 * 负象限点负责拆穿 |x| 型伪装（sqrt(x²) 在正校验点可通过、负点必露馅）；
 * 容差按校验点各项量级取相对值，1e-6 / 1e+6 级系数均不受浮点噪声干扰。
 * 探针 / 校验点出现非有限值（NaN/±Inf）直接判非线性：线性函数是多项式，处处有限。
 */
export function isLinear(f: BinaryFn, p: LineParams): boolean {
  const f0 = f(0, 0);
  if (!Number.isFinite(f0) || !Number.isFinite(p.a) || !Number.isFinite(p.b) || !Number.isFinite(p.c)) return false;
  const CHECK_POINTS: ReadonlyArray<readonly [number, number]> = [[2, 3], [-2, -3]];
  for (const [x, y] of CHECK_POINTS) {
    const actual = f(x, y);
    if (!Number.isFinite(actual)) return false;
    const predicted = f0 + p.a * x + p.b * y;
    const scale = Math.max(1, Math.abs(p.a * x), Math.abs(p.b * y), Math.abs(f0));
    if (Math.abs(actual - predicted) > 1e-9 * scale) return false;
  }
  return true;
}

/** 隐式分类结果：line 出图；nonlinear 留待二次分类器（ZOO-147）；degenerate 友好报错。 */
export type ImplicitOutcome =
  | { kind: 'line'; params: LineParams }
  | { kind: 'nonlinear' }
  | { kind: 'degenerate'; message: string };

/** 近零阈值（风险 R2 同源）：按系数量级取相对值，防浮点残值误判 a=b=0。 */
const ZERO_EPS = 1e-12;

/** 隐式分类入口：探针 → 线性校验 → 特例分流（竖线并入 line；常数等式单独报错）。 */
export function classifyImplicit(f: BinaryFn): ImplicitOutcome {
  const p = probeLinear(f);
  if (!isLinear(f, p)) return { kind: 'nonlinear' };
  const scale = Math.max(1, Math.abs(p.a), Math.abs(p.b), Math.abs(p.c));
  const noX = Math.abs(p.a) <= ZERO_EPS * scale;
  const noY = Math.abs(p.b) <= ZERO_EPS * scale;
  if (noX && noY) {
    // a=b=0：F(x,y)≡−c。c≈0 恒真（如 x−x=0），否则恒假（如 0=1）——均无图像
    return Math.abs(p.c) <= ZERO_EPS * scale
      ? { kind: 'degenerate', message: '该等式恒成立（化简后为 0=0），不表示任何曲线' }
      : { kind: 'degenerate', message: '该等式恒不成立（化简后左右两侧不相等），无图像' };
  }
  return { kind: 'line', params: p };
}

// —— 直线教学参数（属性面板只读展示，D7「探针路线独有的教学收益」）——

export interface LineTeachingInfo {
  /** b≠0：斜率 −a/b；b=0（竖线）斜率不存在 → null */
  slope: number | null;
  /** b≠0：y 轴截距 c/b；竖线 → null */
  yIntercept: number | null;
  /** a≠0：x 轴截距 c/a */
  xIntercept: number | null;
  /** b=0：竖直线 x=c/a */
  verticalX: number | null;
}

/** 一般式系数 → 教学参数（斜率 / 截距 / 竖线）。−0 统一归 +0（展示层防「−0」）。 */
export function lineTeachingInfo(p: LineParams): LineTeachingInfo {
  const zero = (v: number) => (v === 0 ? 0 : v);
  const vertical = p.b === 0;
  return {
    slope: vertical ? null : zero(-p.a / p.b),
    yIntercept: vertical ? null : zero(p.c / p.b),
    xIntercept: p.a === 0 ? null : zero(p.c / p.a),
    verticalX: vertical ? zero(p.c / p.a) : null,
  };
}

/** 面板数值格式化：≤6 位有效数字、去尾零、−0 归 0（纯函数，画布与 SVG 共用）。 */
export function formatCoef(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const rounded = Number(v.toPrecision(6));
  return String(rounded === 0 ? 0 : rounded);
}

/**
 * 一般式展示文本（符号规整：a<0 时全体乘 −1 使首项为正；系数 ±1 省略数字）。
 * b=0 → `x=k`（竖线）；a=0 → `y=k`（水平线）；否则 `ax+by=c`。
 */
export function formatGeneralForm(p: LineParams): string {
  const sign = p.a < 0 || (p.a === 0 && p.b < 0) ? -1 : 1;
  const a = p.a * sign;
  const b = p.b * sign;
  const c = p.c * sign;
  const term = (coef: number, sym: string) => {
    if (coef === 0) return '';
    const mag = Math.abs(coef) === 1 ? '' : formatCoef(Math.abs(coef));
    return `${coef < 0 ? '-' : '+'}${mag}${sym}`;
  };
  if (a === 0) return `y=${formatCoef(p.c / p.b)}`;
  if (b === 0) return `x=${formatCoef(p.c / p.a)}`;
  const head = `${Math.abs(a) === 1 ? '' : formatCoef(a)}x`;
  return `${head}${term(b, 'y')}=${formatCoef(c)}`;
}
