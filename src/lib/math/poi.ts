/**
 * 兴趣点（POI）数值求解（ZOO-199）—— 零点 / 极值 / 两曲线交点。
 *
 * 统一管线：均匀扫描采样 → 相邻变号区间 → 二分求精（ZOO-186 报告同款口径）：
 * - 零点：f 变号；
 * - 极值：f′ 变号（derivativeOf 产物——每次求导后必 simplify，坑一见
 *   calculus.ts 文件头；求导不支持 / 非显式函数时极值为空，零点照常）；
 * - 交点：f−g 在两曲线定义域交集上变号。
 *
 * 边界口径：
 * - 采样点恰好为零（|f|≤1e-12）直接收，不走二分；
 * - 非有限值（NaN/±Inf）区间跳过（断笔语义一致）；跳变区间（|Δy| 超视窗
 *   且双侧越出，如 tan 渐近线两侧）不动点——差函数变号≠有交点；收敛点
 *   函数值反超端点（1/x 类极点）同样不动点；
 * - 重根（切触零点，如 x² 在 0）无变号，本方法天然不识别（教学主流场景
 *   为单根，可接受，与 Desmos 数值口径一致）；
 * - 极值只收内点（区间端点处 f′ 同侧不算函数极值）；
 * - 相邻区间收敛到同根时按域宽 1e-6 相对容差去重。
 */
/** 极值点（数学坐标 + 分类）。 */
export interface Extremum {
  x: number;
  y: number;
  kind: 'min' | 'max';
}

/** 两曲线交点（数学坐标）。 */
export interface Intersection {
  x: number;
  y: number;
}

/** POI 扫描采样数（与采样档 160/320/640 无关的独立档——求解精度指标，非渲染密度）。 */
export const POI_SCAN_COUNT = 480;
/** 二分相对收敛阈：区间宽 < 1e-9·max(1,|x|) 即收敛（绝对精度域宽 20 时 ~2e-8）。 */
const BISECT_REL_TOL = 1e-9;
/** 二分迭代上限（2^-60·区间宽，远超收敛阈，仅作护栏）。 */
const BISECT_MAX_ITER = 60;
/** 采样点零判定阈（|f| ≤ 此值直接收，不二分）。 */
const ZERO_EPS = 1e-12;
/** 同根去重相对容差（按域宽归一）。 */
const DUP_REL_TOL = 1e-6;

/**
 * 变号扫描 + 二分求精：返回 [xMin,xMax] 内全部变号根（升序）。
 * ySpan 用于跳变区间过滤（差函数双侧大跳按断笔口径跳过，见文件头）。
 */
function rootsBySignChange(
  fn: (x: number) => number,
  xMin: number,
  xMax: number,
  count: number,
  ySpan: number,
): number[] {
  const n = Math.max(2, Math.round(count));
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const x = xMin + ((xMax - xMin) * i) / (n - 1);
    xs[i] = x;
    const y = fn(x);
    ys[i] = Number.isFinite(y) ? y : NaN;
  }

  const roots: number[] = [];
  const dupTol = (xMax - xMin) * DUP_REL_TOL;
  const push = (x: number) => {
    if (roots.length > 0 && Math.abs(x - roots[roots.length - 1]) <= dupTol) return;
    roots.push(x);
  };

  for (let i = 0; i < n - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    const fa = ys[i];
    const fb = ys[i + 1];
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) continue;
    if (Math.abs(fa) <= ZERO_EPS) {
      // 孤立零点（两侧均非零）才收；连续零段（f−g ≡ 0 的重合曲线，如两条
      // 同方程曲线求交）不是交点——重合段内每个采样点都 |f|≤eps，全跳过，
      // 否则 480 个采样点全成伪交点
      const prev = i > 0 ? ys[i - 1] : NaN;
      const isolated = Math.abs(fb) > ZERO_EPS && !(i > 0 && Math.abs(prev) <= ZERO_EPS);
      if (isolated) push(a);
      continue;
    }
    if (Math.abs(fb) <= ZERO_EPS) continue; // 下一区间以 |fa|≤eps 分支收下，防双计
    // 跳变区间（|Δ| 超视窗高且双侧均大幅越出视窗）：渐近线两侧变号不动点
    const jumpAcross = ySpan > 0 && Math.abs(fb - fa) > ySpan * 2 && Math.abs(fa) > ySpan && Math.abs(fb) > ySpan;
    if (jumpAcross) continue;
    if (fa * fb < 0) {
      const root = bisect(fn, a, b, fa);
      // 极点不动点（1/x 类）：收敛点函数值非有限，或反超两端较小幅度且非
      // 数值噪声量级（真根 |f|→0；极点 |f|→∞；噪声地板 1e-6·max(1,|fa|,|fb|)
      // 防陡峭真根误杀）
      const fr = fn(root);
      const poleLike =
        !Number.isFinite(fr) ||
        (Math.abs(fr) > Math.min(Math.abs(fa), Math.abs(fb)) &&
          Math.abs(fr) > 1e-6 * Math.max(1, Math.abs(fa), Math.abs(fb)));
      if (!poleLike) push(root);
    }
  }
  // 尾点补收：孤立零（前一点非零）才收——重合段尾不产生伪交点
  const lastY = ys[n - 1];
  const lastPrev = n >= 2 ? ys[n - 2] : NaN;
  if (Number.isFinite(lastY) && Math.abs(lastY) <= ZERO_EPS && !(Number.isFinite(lastPrev) && Math.abs(lastPrev) <= ZERO_EPS)) {
    push(xs[n - 1]);
  }
  return roots;
}

/** 二分求精（区间端点函数值已知异号〔fa 为左端〕；返回区间中点收敛值）。 */
function bisect(
  fn: (x: number) => number,
  a: number,
  b: number,
  fa: number,
): number {
  let lo = a;
  let hi = b;
  let flo = fa;
  for (let i = 0; i < BISECT_MAX_ITER; i++) {
    if (hi - lo <= BISECT_REL_TOL * Math.max(1, Math.abs(lo), Math.abs(hi))) break;
    const mid = (lo + hi) / 2;
    const fm = fn(mid);
    if (!Number.isFinite(fm)) break; // 区间内冒出奇点：保留当前区间不动点
    if (fm === 0) return mid;
    if (flo * fm < 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

/**
 * 零点（ZOO-199）：[xMin,xMax] 内 f 的全部变号根（x 坐标，升序去重）。
 * ySpan 为绘制视窗高（跳变过滤基准；缺省按域宽 ×10 估——足够宽不误杀单侧陡段）。
 */
export function zerosOf(
  fn: (x: number) => number,
  xMin: number,
  xMax: number,
  ySpan?: number,
  count: number = POI_SCAN_COUNT,
): number[] {
  if (!(xMin < xMax)) return [];
  return rootsBySignChange(fn, xMin, xMax, count, ySpan ?? (xMax - xMin) * 10);
}

/**
 * 极值（ZOO-199）：f′ 在 [xMin,xMax] 内的全部变号根 → 分类（f′ 由负转正 =
 * 极小 / 由正转负 = 极大）+ 回代 f 得 y。dfn 为导函数（derivativeOf 产物），
 * 不可导（dfn(x) 非有限）区间自动跳过；dfn 传 null（求导不支持）返回空。
 */
export function extremaOf(
  fn: (x: number) => number,
  dfn: ((x: number) => number) | null,
  xMin: number,
  xMax: number,
  ySpan?: number,
  count: number = POI_SCAN_COUNT,
): Extremum[] {
  if (!dfn || !(xMin < xMax)) return [];
  const span = ySpan ?? (xMax - xMin) * 10;
  const roots = rootsBySignChange(dfn, xMin, xMax, count, span);
  const out: Extremum[] = [];
  for (const x of roots) {
    const y = fn(x);
    if (!Number.isFinite(y)) continue;
    // 分类：根邻域两侧 f′ 符号（h 取域宽 1e-4，落在二分收敛半径内）
    const h = (xMax - xMin) * 1e-4;
    const before = dfn(x - h);
    const after = dfn(x + h);
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    if (before < 0 && after > 0) out.push({ x, y, kind: 'min' });
    else if (before > 0 && after < 0) out.push({ x, y, kind: 'max' });
    // before·after ≥ 0：切触驻点（如 x³ 的 0 点）非极值，丢弃
  }
  return out;
}

/**
 * 两曲线交点（ZOO-199）：[xMin,xMax]（两曲线定义域交集，调用方裁好）上
 * f−g 变号 + 二分。任一侧非有限的点跳过（断笔对齐——无交点语义）；
 * ySpan 为绘制视窗高基准（渐近线大跳过滤）。
 */
export function intersectionsOf(
  fa: (x: number) => number,
  fb: (x: number) => number,
  xMin: number,
  xMax: number,
  ySpan?: number,
  count: number = POI_SCAN_COUNT,
): Intersection[] {
  if (!(xMin < xMax)) return [];
  const diff = (x: number) => {
    const a = fa(x);
    const b = fb(x);
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : NaN;
  };
  const roots = rootsBySignChange(diff, xMin, xMax, count, ySpan ?? (xMax - xMin) * 10);
  const out: Intersection[] = [];
  for (const x of roots) {
    const y = fa(x);
    if (!Number.isFinite(y)) continue;
    out.push({ x, y });
  }
  return out;
}

/**
 * POI 坐标文本（canvas / SVG 导出 / 悬停标签共用，保证三渲染面一致）：
 * `(x, y)`，数字 ≤2 位小数去尾零（formatOverlayNumber 同款口径，本地实现
 * 避免与本模块产生 plot.ts 反向依赖）。
 */
export function formatPoiCoord(x: number, y: number): string {
  const fmt = (v: number): string => {
    let s = v.toFixed(2);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  };
  return `(${fmt(x)}, ${fmt(y)})`;
}
