/**
 * 隐式二元方程分类器（ZOO-146，设计文档 D7 / 可行性研究 §2–§3「数值探针」路线）。
 *
 * 纯函数层：不 import mathjs —— 安全求值器 F(x,y) 由 parse.ts 的隐式分支
 * （顶层 split `=` → F=lhs−rhs → AST 白名单 + compile，scope 含 x/y）注入，
 * 故本模块可脱离 mathjs 独立单测。P0 交付二元一次 → kind='line'（含竖线）；
 * ZOO-147 增二次 9 点探针 + 判别式分类 → 'parabola' / 'hyperbola'（B=0 轴对齐，
 * 含平移与四开口方向）；ZOO-148 增退化拆解 → 'linePair'（相交/平行/重合直线）
 * 与 'point'（单点），空集给教学文案；ZOO-149 增 xy 交叉项坐标旋转（θ=½atan2
 * (B,A−C) 消交叉项）与椭圆型一般式 → 'ellipse'（含旋转），至此一般二次方程
 * Ax²+Bxy+Cy²+Dx+Ey+F₀=0 全形态直接出图（分类器 miss 仅剩非多项式）。
 *
 * 线性探针（研究报告 §2.1，mathjs 不能 parse 裸等式，故顶层 `=` 手工 split）：
 *   a = F(1,0)−F(0,0)   b = F(0,1)−F(0,0)   c = −F(0,0)
 * 输入形态无关：`2(x+y)=3x−4`、`x/2−y=1`、变序 `6=3x+2y` 等等价书写全部命中。
 *
 * 二次探针（研究报告 §3，ZOO-147）：F(x,y)=Ax²+Bxy+Cy²+Dx+Ey+F₀ 的 9 点求值
 * 精确恢复系数（对称差分，见 probeQuadratic）；分类走判别式 δ=B²−4AC（旋转
 * 不变量）：δ≈0 抛物线、δ>0 双曲线、δ<0 椭圆型（ZOO-149 起直接出椭圆）。
 *
 * 退化拆解（ZOO-148，研究报告 §3.2）：两直线（相交 / 平行 / 重合）分解为
 * linePair 出图（复用 line 全部设施）；单点出标记点 kind='point'；空集给
 * 教学文案（错误占位元素承载，研究报告建议）。旋转形退化（如 (x+y)²=2 →
 * 平行斜线对）在 ZOO-149 旋转路径内同规则拆解。
 */
import type {
  DegeneratePointParams,
  EllipseParams,
  HyperbolaParams,
  LineParams,
  LinePairParams,
  ParabolaParams,
} from './types';

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
 * 隐式分类结果：line / linePair / point / parabola / hyperbola / ellipse 出图
 * （ellipse 为 ZOO-149 新增出口：一般形与旋转形椭圆）；nonlinear 为非多项式
 * （sin 等）；degenerate 携教学文案（常数等式 / 空集——无图像，错误占位元素
 * 承载）；unsupported 携引导文案（非多项式隐式）。
 */
export type ImplicitOutcome =
  | { kind: 'line'; params: LineParams }
  | { kind: 'linePair'; params: LinePairParams }
  | { kind: 'point'; params: DegeneratePointParams }
  | { kind: 'parabola'; params: ParabolaParams }
  | { kind: 'hyperbola'; params: HyperbolaParams }
  | { kind: 'ellipse'; params: EllipseParams }
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

/** 空集文案（ZOO-148，研究报告 §3.2：错误占位元素承载，教学可解释）。 */
const EMPTY_VAR_MSG = (v: 'x' | 'y') => `该方程为空集：${v} 的二次式判别式小于 0、无实根，实数平面内无图像（如 ${v}²=−4）`;
const EMPTY_ELLIPSE_MSG = '该方程为空集：左侧恒正（或恒负）、无法等于 0，实数平面内无图像（如 x²+y²=−1）';
/** 旋转抛物线型空集文案（ZOO-149）：残留变量为旋转坐标 u，非裸 x/y。 */
const EMPTY_ROTATED_VAR_MSG = '该方程为空集：旋转坐标 u 的二次式判别式小于 0、无实根，实数平面内无图像';

/**
 * 单变量二次 Av²+Pv+Q=0 的实根分解（判别式按各项量级取相对容差）：
 * 两异根 → roots；重根 → double；无实根 → null（空集）。
 */
function solveQuadratic1v(A: number, P: number, Q: number): { roots: [number, number] } | { double: number } | null {
  const disc = P * P - 4 * A * Q;
  const tol = 1e-9 * (P * P + Math.abs(A * Q) + 1);
  if (disc < -tol) return null;
  if (Math.abs(disc) <= tol) return { double: -P / (2 * A) };
  const s = Math.sqrt(disc);
  return { roots: [(-P - s) / (2 * A), (-P + s) / (2 * A)] };
}

/**
 * 旋转角规范化到 (−π/2, π/2]（主轴方向半圆，展示与采样统一约定）。
 */
function canonicalAngle(phi: number): number {
  let a = phi;
  while (a > Math.PI / 2 + 1e-12) a -= Math.PI;
  while (a <= -Math.PI / 2 - 1e-12) a += Math.PI;
  return clean(a);
}

/**
 * 直线一般式整形（ZOO-149 旋转直线对）：单位化 → 浮点尘埃与 ±1 邻域吸附 →
 * 首项系数归一（`0.707107x+0.707107y=1` → `x+y=1.41421`）。采样与间距对
 * (a,b,c) 整体缩放不变，整形只影响展示与存储整洁度。
 */
function tidyLine(a: number, b: number, c: number): LineParams {
  const snap = (v: number) => (Math.abs(Math.abs(v) - 1) < 1e-9 ? Math.sign(v) : clean(v));
  const norm = Math.hypot(a, b) || 1;
  let la = snap(a / norm);
  let lb = snap(b / norm);
  const lc = clean(c / norm);
  const lead = Math.abs(la) >= Math.abs(lb) ? la : lb;
  if (lead !== 0 && Math.abs(Math.abs(lead) - 1) > 1e-12) {
    const s = 1 / Math.abs(lead);
    la = snap(la * s);
    lb = snap(lb * s);
    return { a: la, b: lb, c: clean(lc * s) };
  }
  return { a: la, b: lb, c: lc };
}

/**
 * 含 xy 交叉项的旋转二次分类（ZOO-149，研究报告 §3.3）：坐标旋转 θ=½atan2(B, A−C)
 * 消交叉项——旋转坐标 u=x·cosθ+y·sinθ、v=−x·sinθ+y·cosθ 下二次部分对角化，
 * 特征值 λ₁,₂=(A+C)/2±R（R=√(((A−C)/2)²+(B/2)²)，λ₁ 为 u² 系数）；判别式
 * δ=B²−4AC=−4λ₁λ₂ 旋转不变：δ<0 椭圆 / δ>0 双曲线（先 Cramer 解中心 (h,k)，
 * 中心化余项 K'=F₀−(Ah²+Bhk+Ck²)，K'≈0 退化为相交直线对 / 单点）/ δ≈0 抛物线
 * （旋转后一次项 D'u+E'v，E'≈0 判平行线族）。系数须先按二次部分归一。
 */
function classifyRotated(A: number, B: number, C: number, D: number, E: number, F: number): ImplicitOutcome {
  const theta = 0.5 * Math.atan2(B, A - C);
  const r = Math.hypot((A - C) / 2, B / 2);
  const lambda1 = (A + C) / 2 + r; // u² 系数（|λ₁| ≥ |λ₂|）
  const lambda2 = (A + C) / 2 - r; // v² 系数
  const delta = B * B - 4 * A * C; // = −4λ₁λ₂（旋转不变量）
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  if (Math.abs(delta) <= DELTA_TOL) {
    // 抛物线型：λ₂≈0，旋转后 λ₁u²+D'u+E'v+F₀=0
    const d1 = D * cos + E * sin; // u 一次系数
    const e1 = -D * sin + E * cos; // v 一次系数（开口轴）
    if (Math.abs(e1) <= LIN_TOL * Math.max(1, Math.abs(d1), Math.abs(e1), Math.abs(F))) {
      // 缺轴向项：λ₁u²+D'u+F₀=0 → 平行线族 u=root（⊥ u 轴，一般式 a=cosθ、b=sinθ）
      const solved = solveQuadratic1v(lambda1, d1, F);
      if (!solved) return { kind: 'degenerate', message: EMPTY_ROTATED_VAR_MSG };
      const lineOf = (root: number): LineParams => tidyLine(cos, sin, root);
      if ('double' in solved) {
        return { kind: 'linePair', params: { lines: [lineOf(solved.double)], mode: 'coincident' } };
      }
      return { kind: 'linePair', params: { lines: [lineOf(solved.roots[0]), lineOf(solved.roots[1])], mode: 'parallel' } };
    }
    // λ₁(u−u₀)² = −E'·(v−v₀)：顶点旋转坐标 (u₀,v₀)，焦参数 p=−E'/(4λ₁) 沿 v 轴。
    // 主轴角规范到 (−90°,90°]：平移 π 时 e₁ 反向，带符号的 p 随之翻转。
    const u0 = -d1 / (2 * lambda1);
    const v0 = (d1 * d1) / (4 * lambda1 * e1) - F / e1;
    const axisAngle = theta + Math.PI / 2; // 对称轴 = v 轴方向
    const rotation = canonicalAngle(axisAngle);
    const p = Math.round((axisAngle - rotation) / Math.PI) % 2 === 0 ? -e1 / (4 * lambda1) : e1 / (4 * lambda1);
    return {
      kind: 'parabola',
      params: {
        h: clean(u0 * cos - v0 * sin),
        k: clean(u0 * sin + v0 * cos),
        p: clean(p),
        axis: Math.abs(Math.cos(rotation)) >= Math.abs(Math.sin(rotation)) ? 'x' : 'y',
        rotation,
      },
    };
  }

  // 中心 (h,k)：2Ah+Bk+D=0、Bh+2Ck+E=0 联立（δ≠0 ⟹ 系数矩阵可逆，Cramer）
  const det = 4 * A * C - B * B; // = −δ ≠ 0
  const h = (B * E - 2 * C * D) / det;
  const k = (B * D - 2 * A * E) / det;
  const kRemain = F - (A * h * h + B * h * k + C * k * k); // 中心化余项 K'
  const kMag = Math.abs(A * h * h) + Math.abs(B * h * k) + Math.abs(C * k * k) + Math.abs(F);

  if (delta < 0) {
    // 椭圆型（λ₁λ₂>0 同号）：λ₁u²+λ₂v²=−K'
    if (Math.abs(kRemain) <= 1e-9 * (kMag + 1)) {
      // K'=0：平方和为零 ⟺ 退化单点 (h,k)
      return { kind: 'point', params: { x: clean(h), y: clean(k) } };
    }
    if ((kRemain < 0) !== (lambda1 > 0)) return { kind: 'degenerate', message: EMPTY_ELLIPSE_MSG };
    return {
      kind: 'ellipse',
      params: {
        cx: clean(h),
        cy: clean(k),
        rx: clean(Math.sqrt(-kRemain / lambda1)),
        ry: clean(Math.sqrt(-kRemain / lambda2)),
        rotation: theta,
      },
    };
  }

  // 双曲线型（λ₁λ₂<0）：λ₁u²+λ₂v²=−K'，与 −K' 同号的 λ 为实轴
  if (Math.abs(kRemain) <= 1e-9 * (kMag + 1)) {
    // K'=0：λ₁u²=−λ₂v² → u=±m·v（m=√(−λ₂/λ₁)），两条相交直线过 (h,k)；
    // u∓m·v=0 映回 xy：X(cos±m·sin)+Y(sin∓m·cos)=0（X=x−h、Y=y−k，c=a·h+b·k）
    const m = Math.sqrt(-lambda2 / lambda1);
    const line = (s1: 1 | -1, s2: 1 | -1): LineParams => {
      const a = cos + s1 * m * sin;
      const b = sin + s2 * m * cos;
      return tidyLine(a, b, a * h + b * k);
    };
    return {
      kind: 'linePair',
      params: { lines: [line(1, -1), line(-1, 1)], mode: 'intersecting' },
    };
  }
  const uTransverse = lambda1 > 0 === -kRemain > 0; // 实轴在 u（X' 轴，转角 θ）上
  const lt = uTransverse ? lambda1 : lambda2;
  const lc = uTransverse ? lambda2 : lambda1;
  const rotation = canonicalAngle(uTransverse ? theta : theta + Math.PI / 2);
  return {
    kind: 'hyperbola',
    params: {
      h: clean(h),
      k: clean(k),
      a: clean(Math.sqrt(Math.abs(-kRemain / lt))),
      b: clean(Math.sqrt(Math.abs(-kRemain / lc))),
      axis: Math.abs(Math.cos(rotation)) >= Math.abs(Math.sin(rotation)) ? 'x' : 'y',
      rotation,
    },
  };
}

/**
 * 一般二次系数分类（系数先按二次部分归一）：
 * |B|>0 → classifyRotated 坐标旋转（ZOO-149：椭圆 / 双曲线 / 抛物线及旋转退化）；
 * δ≈0 → parabola（配方取顶点与焦参数）；轴向线性系数为零则退化为平行/重合
 *       直线或空集（单变量二次求根，ZOO-148）；
 * δ>0 → hyperbola（中心 (−D/2A, −E/2C)，K=Ah²+Ck²−F 的符号定实轴方向）；
 *       K≈0 退化为两条相交直线（过中心 (h,k)，ZOO-148）；
 * δ<0 → 椭圆型：K≈0 退化为单点 (h,k)、K 与 A 异号为空集（ZOO-148），
 *       否则直接出椭圆 A(x−h)²+C(y−k)²=K（ZOO-149，轴对齐 rotation 缺省）。
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

  if (Math.abs(B) > B_TOL) return classifyRotated(A, B, C, D, E, F);
  const delta = -4 * A * C; // B≈0

  if (Math.abs(delta) <= DELTA_TOL) {
    // 抛物线型：A、C 恰一非零（|δ|≈0 ⟺ AC≈0）
    if (Math.abs(A) >= Math.abs(C)) {
      // A x²+Dx+Ey+F = 0 → (x−h)² = 4p(y−k)，要求 E≠0；E=0 时为 x 的二次式
      if (Math.abs(E) <= LIN_TOL * Math.max(1, Math.abs(D), Math.abs(E), Math.abs(F))) {
        return classifyAxisAlignedQuadratic(A, D, F, 'x');
      }
      const h = -D / (2 * A);
      const k = (A * h * h - F) / E;
      return { kind: 'parabola', params: { h: clean(h), k: clean(k), p: clean(-E / (4 * A)), axis: 'y' } };
    }
    // C y²+Ey+Dx+F = 0 → (y−k)² = 4p(x−h)，要求 D≠0；D=0 时为 y 的二次式
    if (Math.abs(D) <= LIN_TOL * Math.max(1, Math.abs(D), Math.abs(E), Math.abs(F))) {
      return classifyAxisAlignedQuadratic(C, E, F, 'y');
    }
    const k = -E / (2 * C);
    const h = (C * k * k - F) / D;
    return { kind: 'parabola', params: { h: clean(h), k: clean(k), p: clean(-D / (4 * C)), axis: 'x' } };
  }

  // 中心 (h,k)：一次项配方消去（椭圆型 / 双曲线型共用）
  const h = -D / (2 * A);
  const k = -E / (2 * C);
  const K = A * h * h + C * k * k - F;
  const kMag = Math.abs(A * h * h) + Math.abs(C * k * k) + Math.abs(F);

  if (delta < 0) {
    // 椭圆型（A、C 同号）：A(x−h)²+C(y−k)²=K
    if (Math.abs(K) <= 1e-9 * (kMag + 1)) {
      // K=0：平方和为零 ⟺ 两平方同时为零 → 退化单点 (h,k)
      return { kind: 'point', params: { x: clean(h), y: clean(k) } };
    }
    if (K > 0 !== A > 0) return { kind: 'degenerate', message: EMPTY_ELLIPSE_MSG };
    // ZOO-149：椭圆型一般式直接出图（半轴²=K/系数，符号已保证为正）
    return {
      kind: 'ellipse',
      params: { cx: clean(h), cy: clean(k), rx: clean(Math.sqrt(K / A)), ry: clean(Math.sqrt(K / C)) },
    };
  }

  // 双曲线：A、C 异号非零，K 的符号定实轴。
  if (Math.abs(K) <= 1e-9 * (kMag + 1)) {
    // K=0：A(x−h)²=−C(y−k)²，两侧同号 → (x−h)=±√(−C/A)(y−k)，两条相交直线过 (h,k)
    const m = Math.sqrt(-C / A);
    return {
      kind: 'linePair',
      params: {
        lines: [
          { a: 1, b: -m, c: clean(h - m * k) }, // x−m·y = h−m·k
          { a: 1, b: m, c: clean(h + m * k) }, // x+m·y = h+m·k
        ],
        mode: 'intersecting',
      },
    };
  }
  // A(x−h)²+C(y−k)²=K：与 K 同号的二次项系数所在轴为实轴（该项进 =1 侧为正）
  const xAxisTransverse = A > 0 === K > 0;
  const a = Math.sqrt(Math.abs(K / (xAxisTransverse ? A : C)));
  const b = Math.sqrt(Math.abs(K / (xAxisTransverse ? C : A)));
  return { kind: 'hyperbola', params: { h: clean(h), k: clean(k), a, b, axis: xAxisTransverse ? 'x' : 'y' } };
}

/**
 * 抛物线型缺轴向项的退化拆解（ZOO-148）：A v²+Pv+Q=0（v 为残留二次变量）——
 * 两异根 → 一对平行直线 v=root₁ / v=root₂；重根 → 一条（重合）直线；无实根 → 空集。
 */
function classifyAxisAlignedQuadratic(A: number, P: number, Q: number, v: 'x' | 'y'): ImplicitOutcome {
  const solved = solveQuadratic1v(A, P, Q);
  if (!solved) return { kind: 'degenerate', message: EMPTY_VAR_MSG(v) };
  const lineOf = (root: number): LineParams => (v === 'x' ? { a: 1, b: 0, c: clean(root) } : { a: 0, b: 1, c: clean(root) });
  if ('double' in solved) {
    return { kind: 'linePair', params: { lines: [lineOf(solved.double)], mode: 'coincident' } };
  }
  return { kind: 'linePair', params: { lines: [lineOf(solved.roots[0]), lineOf(solved.roots[1])], mode: 'parallel' } };
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

// —— 抛物线 / 双曲线 / 椭圆教学参数（属性面板只读展示，ZOO-147/149「探针路线独有收益」）——

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

/** 分母展示：1 省略（标准形 `x²/16-y²/9=1` 的 `/16`）。 */
const fracDen = (v: number) => (Math.abs(v - 1) < 1e-9 ? '' : `/${formatCoef(clean(v))}`);

/** 旋转角展示（弧度 → 度，≤6 位有效数字，如 `45°` / `-30°`）。 */
export function formatAngle(rad: number): string {
  return `${formatCoef(clean((rad * 180) / Math.PI))}°`;
}

/**
 * 直线一般式展示（首项系数归一，如 `x+y=1.41421` / `x=0`）：a、b 不同时为零。
 * 旋转形的渐近线 / 准线 / 准线方向无法用 `x = k` 斜截式表述，统一走一般式。
 */
function lineEquation(a: number, b: number, c: number): string {
  const lead = Math.abs(a) >= Math.abs(b) ? a : b; // 主系数（较大者，作归一分母）
  const s = (lead < 0 ? -1 : 1) / Math.abs(lead);
  // ±1 邻域吸附：0.9999999999999998 之类的归一残值防「x+1y=…」噪声
  const snap = (v: number) => (Math.abs(Math.abs(v) - 1) < 1e-9 ? Math.sign(v) : clean(v));
  return formatGeneralForm({ a: snap(a * s), b: snap(b * s), c: clean(c * s) });
}

/** 方向角规范化到 (−180°, 180°]（开口方向是有向的，不能像主轴那样对折到 90°）。 */
function normalizeDirection(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return clean(a);
}

export interface ParabolaTeachingInfo {
  /** 标准形（如 `(y-1)²=8(x+2)`；旋转形 `Y'²=4p·X'`） */
  standardForm: string;
  vertex: string;
  focus: string;
  /** 准线方程（`x = k` / `y = k`；旋转形为一般式） */
  directrix: string;
  /** 开口方向：向右 / 向左 / 向上 / 向下；旋转形为方向角 */
  opening: string;
  /** 旋转角（含 xy 交叉项时非空，如 `45°`）；轴对齐为 undefined */
  rotation?: string;
}

/**
 * 抛物线参数 → 教学参数（顶点 / 焦点 / 准线 / 开口，D7 教学收益）。旋转形
 * （ZOO-149）：对称轴单位向量 e₁=(cos φ, sin φ)，标准形 Y'²=4pX' 在以顶点为
 * 原点、X' 轴沿 φ 方向的旋转坐标系中表述。
 */
export function parabolaTeachingInfo(p: ParabolaParams): ParabolaTeachingInfo {
  const rotation = p.rotation !== undefined && Math.abs(p.rotation) > 1e-9 ? p.rotation : null;
  if (rotation === null) {
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
  const e1x = Math.cos(rotation);
  const e1y = Math.sin(rotation);
  return {
    standardForm: `Y'²=${coefTerm(4 * p.p)}X'`,
    vertex: formatPoint(p.h, p.k),
    focus: formatPoint(p.h + p.p * e1x, p.k + p.p * e1y),
    // 准线 ⊥ 对称轴、过顶点后方 p 处：e₁·X = e₁·V − p
    directrix: lineEquation(e1x, e1y, e1x * p.h + e1y * p.k - p.p),
    opening: `沿 ${formatAngle(normalizeDirection(p.p > 0 ? rotation : rotation + Math.PI))} 方向`,
    rotation: formatAngle(rotation),
  };
}

export interface HyperbolaTeachingInfo {
  /** 标准形（如 `(x-1)²/4-(y+2)²/9=1`；旋转形 `X'²/a²-Y'²/b²=1`；分母 1 省略） */
  standardForm: string;
  center: string;
  /** `a = 2, b = 3, c = 3.60555`（c 为半焦距） */
  axes: string;
  foci: string;
  /** 渐近线方程（平移形 `(y+2) = ±1.5(x-1)`；旋转形为两条一般式） */
  asymptotes: string;
  /** 准线（`x = 1±1.109`；旋转形为两条一般式） */
  directrices: string;
  /** 离心率 e = c/a */
  eccentricity: string;
  /** 旋转角（含 xy 交叉项时非空）；轴对齐为 undefined */
  rotation?: string;
}

/**
 * 双曲线参数 → 教学参数（中心 / 半轴 / 焦点 / 渐近线 / 准线 / 离心率）。
 * 旋转形（ZOO-149）：实轴单位向量 e_t=(cos φ, sin φ)、虚轴 e_c ⊥ e_t，
 * 焦点沿 e_t、渐近线为过中心方向 a·e_t±b·e_c 的两条直线、准线 ⊥ 实轴。
 */
export function hyperbolaTeachingInfo(p: HyperbolaParams): HyperbolaTeachingInfo {
  const c = Math.hypot(p.a, p.b);
  const e = c / p.a;
  const dOffset = (p.a * p.a) / c; // 准线到中心的距离 a²/c
  const rotation = p.rotation !== undefined && Math.abs(p.rotation) > 1e-9 ? p.rotation : null;
  if (rotation === null) {
    const cross = p.b / p.a; // 渐近线斜率绝对值：axis='x' 时 y−k=±(b/a)(x−h)；axis='y' 时 x−h=±(b/a)(y−k)
    const axisOffset = (v: number) => (clean(v) === 0 ? `±${formatCoef(dOffset)}` : `${formatCoef(clean(v))}±${formatCoef(dOffset)}`);
    return {
      standardForm:
        p.axis === 'x'
          ? `${shiftTerm(p.h, 'x')}²${fracDen(p.a * p.a)}-${shiftTerm(p.k, 'y')}²${fracDen(p.b * p.b)}=1`
          : `${shiftTerm(p.k, 'y')}²${fracDen(p.a * p.a)}-${shiftTerm(p.h, 'x')}²${fracDen(p.b * p.b)}=1`,
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
  const etx = Math.cos(rotation);
  const ety = Math.sin(rotation);
  const ecx = -ety;
  const ecy = etx;
  // 渐近线：过中心、方向 a·e_t ± b·e_c → 一般式（法向量 (dy, −dx)）
  const lineByDir = (dx: number, dy: number) => lineEquation(dy, -dx, dy * p.h - dx * p.k);
  const mid = etx * p.h + ety * p.k; // 准线：e_t·X = e_t·C ± a²/c
  return {
    standardForm: `X'²${fracDen(p.a * p.a)}-Y'²${fracDen(p.b * p.b)}=1`,
    center: formatPoint(p.h, p.k),
    axes: `a = ${formatCoef(p.a)}, b = ${formatCoef(p.b)}, c = ${formatCoef(clean(c))}`,
    foci: `${formatPoint(p.h - c * etx, p.k - c * ety)} 与 ${formatPoint(p.h + c * etx, p.k + c * ety)}`,
    asymptotes: `${lineByDir(p.a * etx + p.b * ecx, p.a * ety + p.b * ecy)} 与 ${lineByDir(p.a * etx - p.b * ecx, p.a * ety - p.b * ecy)}`,
    directrices: `${lineEquation(etx, ety, mid - dOffset)} 与 ${lineEquation(etx, ety, mid + dOffset)}`,
    eccentricity: formatCoef(clean(e)),
    rotation: formatAngle(rotation),
  };
}

export interface EllipseTeachingInfo {
  /** 标准形（如 `(x-1)²/4+(y+2)²/9=1`；旋转形 `X'²/4+Y'²/9=1`） */
  standardForm: string;
  center: string;
  /** `a = 3, b = 2, c = 2.23607`（a 长半轴、c 半焦距；圆时 c = 0） */
  axes: string;
  foci: string;
  /** 离心率 e = c/a（圆为 0） */
  eccentricity: string;
  /** 旋转角（含 xy 交叉项时非空）；轴对齐为 undefined */
  rotation?: string;
}

/**
 * 椭圆参数 → 教学参数（中心 / 长短半轴 / 焦点 / 离心率，ZOO-149 面板收益）。
 * rx 沿 X' 轴（角 rotation）、ry 沿 Y' 轴；焦点在长轴上（rx 与 ry 的较大者）。
 */
export function ellipseTeachingInfo(p: EllipseParams): EllipseTeachingInfo {
  const a = Math.max(p.rx, p.ry); // 长半轴
  const b = Math.min(p.rx, p.ry); // 短半轴
  const c = Math.sqrt(Math.max(a * a - b * b, 0)); // 半焦距（rx=ry 圆时为 0）
  const rotation = p.rotation !== undefined && Math.abs(p.rotation) > 1e-9 ? p.rotation : null;
  const majorAlongX = p.rx >= p.ry;
  const ex =
    rotation === null
      ? majorAlongX
        ? 1
        : 0
      : majorAlongX
        ? Math.cos(rotation)
        : -Math.sin(rotation);
  const ey =
    rotation === null
      ? majorAlongX
        ? 0
        : 1
      : majorAlongX
        ? Math.sin(rotation)
        : Math.cos(rotation);
  return {
    standardForm:
      rotation === null
        ? `${shiftTerm(p.cx, 'x')}²${fracDen(p.rx * p.rx)}+${shiftTerm(p.cy, 'y')}²${fracDen(p.ry * p.ry)}=1`
        : `X'²${fracDen(p.rx * p.rx)}+Y'²${fracDen(p.ry * p.ry)}=1`,
    center: formatPoint(p.cx, p.cy),
    axes: `a = ${formatCoef(a)}, b = ${formatCoef(b)}, c = ${formatCoef(clean(c))}`,
    foci:
      c < 1e-9
        ? `${formatPoint(p.cx, p.cy)}（rx = ry：焦点重合于中心，为圆）`
        : `${formatPoint(p.cx - c * ex, p.cy - c * ey)} 与 ${formatPoint(p.cx + c * ex, p.cy + c * ey)}`,
    eccentricity: formatCoef(clean(c / a)),
    rotation: rotation === null ? undefined : formatAngle(rotation),
  };
}

// —— 退化形教学参数（ZOO-148，属性面板只读展示）——

export interface LinePairTeachingInfo {
  /** 退化形态：两条相交直线 / 两条平行直线 / 一对重合直线 */
  label: string;
  /** 各直线一般式（重合时一条） */
  equations: string[];
  /** 交点（相交）/ 间距（平行）/ 重合说明 */
  detail: string;
}

/**
 * 退化直线对 → 教学参数：相交给交点（两直线联立，即退化前的中心）；平行给
 * 间距 d=|c₁−c₂|/√(a²+b²)（两线已同 a,b）；重合说明两根相等。
 */
export function linePairTeachingInfo(p: LinePairParams): LinePairTeachingInfo {
  const equations = p.lines.map(formatGeneralForm);
  if (p.mode === 'intersecting') {
    const [l1, l2] = p.lines;
    const det = l1.a * l2.b - l2.a * l1.b; // 相交 ⟹ 非零
    if (det === 0) return { label: '两条相交直线', equations, detail: '' };
    const px = (l1.c * l2.b - l2.c * l1.b) / det;
    const py = (l1.a * l2.c - l2.a * l1.c) / det;
    return { label: '两条相交直线', equations, detail: `交点 ${formatPoint(px, py)}` };
  }
  if (p.mode === 'parallel') {
    const [l1, l2] = p.lines;
    const d = Math.abs(l1.c - l2.c) / Math.hypot(l1.a, l1.b);
    return { label: '两条平行直线', equations, detail: `间距 d = ${formatCoef(d)}` };
  }
  return { label: '一对重合直线', equations, detail: '判别式为 0，两根重合于同一条直线' };
}

export interface DegeneratePointTeachingInfo {
  /** 点坐标 (x, y) */
  point: string;
  /** 解的表述（如 `x = 1, y = -2`） */
  solution: string;
}

/** 退化单点 → 教学参数（点坐标 + 唯一解表述）。 */
export function pointTeachingInfo(p: DegeneratePointParams): DegeneratePointTeachingInfo {
  return {
    point: formatPoint(p.x, p.y),
    solution: `x = ${formatCoef(clean(p.x))}, y = ${formatCoef(clean(p.y))}`,
  };
}
