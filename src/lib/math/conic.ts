/**
 * 隐式二元方程分类器（ZOO-146，设计文档 D7 / 可行性研究 §2–§3「数值探针」路线）。
 *
 * 纯函数层：不 import mathjs —— 安全求值器 F(x,y) 由 parse.ts 的隐式分支
 * （顶层 split `=` → F=lhs−rhs → AST 白名单 + compile，scope 含 x/y）注入，
 * 故本模块可脱离 mathjs 独立单测。P0 交付二元一次 → kind='line'（含竖线）；
 * ZOO-147 增二次 9 点探针 + 判别式分类 → 'parabola' / 'hyperbola'（B=0 轴对齐，
 * 含平移与四开口方向）；退化形给友好文案（完整拆解留 ZOO-148）、xy 旋转项与
 * 椭圆型一般式给引导文案（旋转留 ZOO-149）。
 *
 * 线性探针（研究报告 §2.1，mathjs 不能 parse 裸等式，故顶层 `=` 手工 split）：
 *   a = F(1,0)−F(0,0)   b = F(0,1)−F(0,0)   c = −F(0,0)
 * 输入形态无关：`2(x+y)=3x−4`、`x/2−y=1`、变序 `6=3x+2y` 等等价书写全部命中。
 *
 * 二次探针（研究报告 §3，ZOO-147）：F(x,y)=Ax²+Bxy+Cy²+Dx+Ey+F₀ 的 9 点求值
 * 精确恢复系数（对称差分，见 probeQuadratic）；分类走判别式 δ=B²−4AC（旋转
 * 不变量）：δ≈0 抛物线、δ>0 双曲线、δ<0 椭圆型（本环引导至标准形输入）。
 */
import type { HyperbolaParams, LineParams, ParabolaParams } from './types';

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

/**
 * 隐式分类结果：line / parabola / hyperbola 出图；nonlinear 为非多项式（sin 等）；
 * degenerate 携教学文案（常数等式 / 二次退化形，完整拆解见 ZOO-148）；
 * unsupported 携引导文案（xy 旋转项 / 椭圆型一般式，见 ZOO-149）。
 */
export type ImplicitOutcome =
  | { kind: 'line'; params: LineParams }
  | { kind: 'parabola'; params: ParabolaParams }
  | { kind: 'hyperbola'; params: HyperbolaParams }
  | { kind: 'nonlinear' }
  | { kind: 'degenerate'; message: string }
  | { kind: 'unsupported'; message: string };

/** 近零阈值（风险 R2 同源）：按系数量级取相对值，防浮点残值误判 a=b=0。 */
const ZERO_EPS = 1e-12;

/** 隐式分类入口：线性探针 → 二次探针（ZOO-147）→ 特例分流。 */
export function classifyImplicit(f: BinaryFn): ImplicitOutcome {
  const p = probeLinear(f);
  if (isLinear(f, p)) {
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
  const q = probeQuadratic(f);
  if (q && isQuadratic(f, q)) return classifyQuadratic(q);
  return { kind: 'nonlinear' };
}

// —— 二次探针与判别式分类（ZOO-147，研究报告 §3）——

/** 一般二次 Ax²+Bxy+Cy²+Dx+Ey+F₀=0 的探针系数。 */
export interface QuadParams {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
  F: number;
}

/**
 * 二次 9 点探针：对称差分精确恢复系数（探针点非有限 → null，按非线性处理）。
 *   F₀=F(0,0)；A=(F(1,0)+F(−1,0))/2−F₀；C=(F(0,1)+F(0,−1))/2−F₀；
 *   D=(F(1,0)−F(−1,0))/2；E=(F(0,1)−F(0,−1))/2；
 *   B=(F(1,1)+F(−1,−1)−F(1,−1)−F(−1,1))/4（对角对称差分，偶次项全消）。
 */
export function probeQuadratic(f: BinaryFn): QuadParams | null {
  const f00 = f(0, 0);
  const f10 = f(1, 0);
  const fm10 = f(-1, 0);
  const f01 = f(0, 1);
  const f0m1 = f(0, -1);
  const f11 = f(1, 1);
  const f1m1 = f(1, -1);
  const fm11 = f(-1, 1);
  const fm1m1 = f(-1, -1);
  for (const v of [f00, f10, fm10, f01, f0m1, f11, f1m1, fm11, fm1m1]) {
    if (!Number.isFinite(v)) return null;
  }
  return {
    A: (f10 + fm10) / 2 - f00,
    B: (f11 + fm1m1 - f1m1 - fm11) / 4,
    C: (f01 + f0m1) / 2 - f00,
    D: (f10 - fm10) / 2,
    E: (f01 - f0m1) / 2,
    F: f00,
  };
}

/** 二次校验点：正负象限各若干（负象限拆穿 |x|/|y| 伪装）+ 分数点。 */
const QUAD_CHECK_POINTS: ReadonlyArray<readonly [number, number]> = [
  [2, 3],
  [-2, -3],
  [2, -3],
  [-3, 2],
  [0.5, 1.5],
];

/** 二次校验（与 isLinear 同款相对容差）：校验点预测值与实际值逐点比对。 */
export function isQuadratic(f: BinaryFn, q: QuadParams): boolean {
  for (const v of [q.A, q.B, q.C, q.D, q.E, q.F]) {
    if (!Number.isFinite(v)) return false;
  }
  for (const [x, y] of QUAD_CHECK_POINTS) {
    const actual = f(x, y);
    if (!Number.isFinite(actual)) return false;
    const predicted = q.A * x * x + q.B * x * y + q.C * y * y + q.D * x + q.E * y + q.F;
    const scale = Math.max(
      1,
      Math.abs(q.A * x * x),
      Math.abs(q.B * x * y),
      Math.abs(q.C * y * y),
      Math.abs(q.D * x),
      Math.abs(q.E * y),
      Math.abs(q.F),
    );
    if (Math.abs(actual - predicted) > 1e-9 * scale) return false;
  }
  return true;
}

/** xy 旋转项阈值（系数按二次部分最大值归一后，最大为 1）。 */
const B_TOL = 1e-9;
/** 判别式零带（归一后 δ 噪声 ~1e-14 量级，留足余量且不吞掉扁双曲线）。 */
const DELTA_TOL = 1e-7;
/** 抛物线轴向线性系数近零带（归一后，按线性部分量级取相对值）。 */
const LIN_TOL = 1e-9;
/** 系数浮点尘埃归零（展示与参数输出防 −1e-17 之类的噪声）。 */
const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);

const ROTATED_MSG = '该方程含 xy 交叉项（旋转圆锥曲线），暂不支持出图';
const ELLIPSE_TYPE_MSG = '该方程为椭圆型二次方程：请改用椭圆标准形（如 x²/9+y²/4=1）后再输入';
const QUAD_DEGENERATE_MSG = '该二次方程为退化曲线（如两条平行/相交直线、单点或空集），暂不支持出图';

/**
 * 一般二次系数分类（B=0 轴对齐；系数先按二次部分归一）：
 * δ≈0 → parabola（配方取顶点与焦参数，轴向线性系数为零则退化）；
 * δ>0 → hyperbola（中心 (−D/2A, −E/2C)，K=Ah²+Ck²−F 的符号定实轴方向，
 *       K≈0 为退化相交直线）；
 * δ<0 → 椭圆型一般式，本环引导至标准形（ZOO-149 随旋转一并覆盖）。
 */
export function classifyQuadratic(q: QuadParams): ImplicitOutcome {
  const quadScale = Math.max(Math.abs(q.A), Math.abs(q.B), Math.abs(q.C));
  if (!(quadScale > 0)) return { kind: 'nonlinear' };
  const A = q.A / quadScale;
  const B = q.B / quadScale;
  const C = q.C / quadScale;
  const D = q.D / quadScale;
  const E = q.E / quadScale;
  const F = q.F / quadScale;

  if (Math.abs(B) > B_TOL) return { kind: 'unsupported', message: ROTATED_MSG };
  const delta = -4 * A * C; // B≈0

  if (Math.abs(delta) <= DELTA_TOL) {
    // 抛物线型：A、C 恰一非零（|δ|≈0 ⟺ AC≈0）
    if (Math.abs(A) >= Math.abs(C)) {
      // A x²+Dx+Ey+F = 0 → (x−h)² = 4p(y−k)，要求 E≠0（否则为平行直线族退化形）
      if (Math.abs(E) <= LIN_TOL * Math.max(1, Math.abs(D), Math.abs(E), Math.abs(F))) {
        return { kind: 'degenerate', message: QUAD_DEGENERATE_MSG };
      }
      const h = -D / (2 * A);
      const k = (A * h * h - F) / E;
      return { kind: 'parabola', params: { h: clean(h), k: clean(k), p: clean(-E / (4 * A)), axis: 'y' } };
    }
    // C y²+Ey+Dx+F = 0 → (y−k)² = 4p(x−h)，要求 D≠0
    if (Math.abs(D) <= LIN_TOL * Math.max(1, Math.abs(D), Math.abs(E), Math.abs(F))) {
      return { kind: 'degenerate', message: QUAD_DEGENERATE_MSG };
    }
    const k = -E / (2 * C);
    const h = (C * k * k - F) / D;
    return { kind: 'parabola', params: { h: clean(h), k: clean(k), p: clean(-D / (4 * C)), axis: 'x' } };
  }

  if (delta < 0) return { kind: 'unsupported', message: ELLIPSE_TYPE_MSG };

  // 双曲线：A、C 异号非零。中心由一次项配方消去，K 的符号定实轴。
  const h = -D / (2 * A);
  const k = -E / (2 * C);
  const K = A * h * h + C * k * k - F;
  const kMag = Math.abs(A * h * h) + Math.abs(C * k * k) + Math.abs(F);
  if (Math.abs(K) <= 1e-9 * (kMag + 1)) return { kind: 'degenerate', message: QUAD_DEGENERATE_MSG };
  // A(x−h)²+C(y−k)²=K：与 K 同号的二次项系数所在轴为实轴（该项进 =1 侧为正）
  const xAxisTransverse = A > 0 === K > 0;
  const a = Math.sqrt(Math.abs(K / (xAxisTransverse ? A : C)));
  const b = Math.sqrt(Math.abs(K / (xAxisTransverse ? C : A)));
  return { kind: 'hyperbola', params: { h: clean(h), k: clean(k), a, b, axis: xAxisTransverse ? 'x' : 'y' } };
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

// —— 抛物线 / 双曲线教学参数（属性面板只读展示，ZOO-147「探针路线独有收益」）——

/** 平移项展示（幂 / 乘法上下文，需括号）：v≈0 → 裸符号；否则 `(sym-v)` / `(sym+|v|)`。 */
function shiftTerm(v: number, sym: string): string {
  const c = clean(v);
  if (c === 0) return sym;
  return c > 0 ? `(${sym}-${formatCoef(c)})` : `(${sym}+${formatCoef(-c)})`;
}

/** 乘系数展示：±1 省略数字（`(y-1)²=-(x+2)`、渐近线 `±(x-1)`）。 */
function coefTerm(v: number): string {
  const c = clean(v);
  if (Math.abs(c - 1) < 1e-9) return '';
  if (Math.abs(c + 1) < 1e-9) return '-';
  return formatCoef(c);
}

/** 坐标点展示 `(1, -2)`（−0 归 0，≤6 位有效数字）。 */
export function formatPoint(x: number, y: number): string {
  return `(${formatCoef(clean(x))}, ${formatCoef(clean(y))})`;
}

export interface ParabolaTeachingInfo {
  /** 标准形（如 `(y-1)²=8(x+2)`） */
  standardForm: string;
  vertex: string;
  focus: string;
  /** 准线方程（`x = k` / `y = k`） */
  directrix: string;
  /** 开口方向：向右 / 向左 / 向上 / 向下 */
  opening: string;
}

/** 抛物线参数 → 教学参数（顶点 / 焦点 / 准线 / 开口，D7 教学收益）。 */
export function parabolaTeachingInfo(p: ParabolaParams): ParabolaTeachingInfo {
  const focusX = p.axis === 'x' ? p.h + p.p : p.h;
  const focusY = p.axis === 'x' ? p.k : p.k + p.p;
  const opening = p.axis === 'x' ? (p.p > 0 ? '向右' : '向左') : p.p > 0 ? '向上' : '向下';
  const standardForm =
    p.axis === 'x'
      ? `${shiftTerm(p.k, 'y')}²=${coefTerm(4 * p.p)}${shiftTerm(p.h, 'x')}`
      : `${shiftTerm(p.h, 'x')}²=${coefTerm(4 * p.p)}${shiftTerm(p.k, 'y')}`;
  return {
    standardForm,
    vertex: formatPoint(p.h, p.k),
    focus: formatPoint(focusX, focusY),
    directrix:
      p.axis === 'x' ? `x = ${formatCoef(clean(p.h - p.p))}` : `y = ${formatCoef(clean(p.k - p.p))}`,
    opening,
  };
}

export interface HyperbolaTeachingInfo {
  /** 标准形（如 `(x-1)²/4-(y+2)²/9=1`；分母 1 省略） */
  standardForm: string;
  center: string;
  /** `a = 2, b = 3, c = 3.60555`（c 为半焦距） */
  axes: string;
  foci: string;
  /** 渐近线方程（平移形 `(y+2) = ±1.5(x-1)`；无平移时 `y = ±0.75x`） */
  asymptotes: string;
  /** 准线（`x = 1±1.109`；中心在轴上时 `x = ±1.109`） */
  directrices: string;
  /** 离心率 e = c/a */
  eccentricity: string;
}

/** 双曲线参数 → 教学参数（中心 / 半轴 / 焦点 / 渐近线 / 准线 / 离心率）。 */
export function hyperbolaTeachingInfo(p: HyperbolaParams): HyperbolaTeachingInfo {
  const c = Math.hypot(p.a, p.b);
  const e = c / p.a;
  const dOffset = (p.a * p.a) / c; // 准线到中心的距离 a²/c
  const den = (v: number) => (Math.abs(v - 1) < 1e-9 ? '' : `/${formatCoef(clean(v))}`);
  const cross = p.b / p.a; // 渐近线斜率绝对值：axis='x' 时 y−k=±(b/a)(x−h)；axis='y' 时 x−h=±(b/a)(y−k)
  const axisOffset = (v: number) => (clean(v) === 0 ? `±${formatCoef(dOffset)}` : `${formatCoef(clean(v))}±${formatCoef(dOffset)}`);
  return {
    standardForm:
      p.axis === 'x'
        ? `${shiftTerm(p.h, 'x')}²${den(p.a * p.a)}-${shiftTerm(p.k, 'y')}²${den(p.b * p.b)}=1`
        : `${shiftTerm(p.k, 'y')}²${den(p.a * p.a)}-${shiftTerm(p.h, 'x')}²${den(p.b * p.b)}=1`,
    center: formatPoint(p.h, p.k),
    axes: `a = ${formatCoef(p.a)}, b = ${formatCoef(p.b)}, c = ${formatCoef(clean(c))}`,
    foci:
      p.axis === 'x'
        ? `${formatPoint(p.h - c, p.k)} 与 ${formatPoint(p.h + c, p.k)}`
        : `${formatPoint(p.h, p.k - c)} 与 ${formatPoint(p.h, p.k + c)}`,
    asymptotes:
      p.axis === 'x'
        ? `${shiftTerm(p.k, 'y')} = ±${coefTerm(cross)}${shiftTerm(p.h, 'x')}`
        : `${shiftTerm(p.h, 'x')} = ±${coefTerm(cross)}${shiftTerm(p.k, 'y')}`,
    directrices: p.axis === 'x' ? `x = ${axisOffset(p.h)}` : `y = ${axisOffset(p.k)}`,
    eccentricity: formatCoef(clean(e)),
  };
}
