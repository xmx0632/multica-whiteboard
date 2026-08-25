/**
 * 物理模板标注（ZOO-192 T5：抛体/简谐/圆周物理模板包）。
 *
 * trajectoryMarks：参数式轨迹（x=f(t),y=g(t)）的落地/峰值数值标注——渲染管线
 * （plot.ts）按 physics 叠加条目调用，产物为纯数学坐标数据，canvas / SVG 导出
 * 共用（与 T2 切线 / T3 面积 chip 同一套「数据在渲染层、绘制在消费方」分层）。
 * 数值法（网格扫描 + 黄金分割 / 二分精化）对任意抛体形轨迹成立，不依赖方程
 * 文本形态——常量改值（v₀/θ/g）后随渲染签名失效自动重算，实时联动。
 *
 * 单位显示（issue 硬约束）：单位字符串仅作面板显示，不做量纲运算——
 * PHYSICS_CONSTANT_UNITS 为纯字符串表（标注 R/H 不带单位：其量纲取决于用户
 * 输入的单位制，推导即量纲运算，越界）。标注数字格式复用 plot.ts 的
 * formatOverlayNumber（T2 切线标注同款，两渲染面文本一致）。
 */

/**
 * 物理常量单位表（仅显示）：键为存储层 ASCII 常量名（T1 预置槽口径），
 * 值为显示字符串。面板物理区据此渲染 `g = 9.8 m/s²` 风格的只读行；
 * 数值参与运算，单位字符串永不参与。
 * ZOO-213 学段物理模板新增：v（匀速直线速度）、r（欧姆定律电阻 Ω）、
 * d（密度模板的 ρ 替身）、t（机械波周期 T——归一化小写后存储键为 t）、
 * e0（交变电流峰值电动势 E₀）。注：a 在简谐/振幅语境为 m（振幅），在
 * 匀加速语境为 m/s²（加速度）——单位行按常量名显示，语境由模板承载。
 */
export const PHYSICS_CONSTANT_UNITS: Readonly<Record<string, string>> = {
  g: 'm/s²',
  v0: 'm/s',
  v: 'm/s',
  theta: 'rad',
  omega: 'rad/s',
  a: 'm',
  phi: 'rad',
  r: 'Ω',
  d: 'g/cm³',
  t: 's',
  e0: 'V',
};

/** 轨迹标注的数学坐标数据（渲染层与 SVG 导出共用）。 */
export interface TrajectoryMarks {
  /** 抛出点（t 域左端）：射程 R 与峰高 H 的基准点 */
  launch: { x: number; y: number };
  /** 峰值点与峰高（相对抛出高度；抛体自地面抛出时即绝对高度） */
  peak: { x: number; y: number; height: number };
  /** 落地点与射程（水平位移）；域内未落地（弧线被 t 域截断）时缺省——不标 R */
  landing?: { x: number; y: number; range: number };
}

/** 标注扫描网格点数（峰值定位 + 落地越零扫描；域宽上限 1000 下步长仍充分细）。 */
const SCAN_STEPS = 512;
/** 黄金分割 / 二分精化迭代数（每次收敛一个数量级，60 次达双精度饱和）。 */
const REFINE_ITERATIONS = 60;

/**
 * 抛体轨迹标注（ZOO-192 T5）：在 t 域 [min,max] 上对 (fx,fy) 数值求解
 * 峰值（域内极大）与落地点（峰值后首次回落到抛出高度的下行越零点）。
 * 返回 null 的情形（不产出标注、主曲线照常渲染）：
 * - 域非法 / 无有限采样点 / 抛出点无定义；
 * - 峰值贴域端（未上升〔如 θ=0 水平抛出〕或升到域端仍截断——非物理峰值）；
 * - 峰高退化 ≈ 0。
 * 峰值后域内无下行越零（弧线截断在半空）→ 仅峰值标注，landing 缺省。
 */
export function trajectoryMarks(
  fx: (t: number) => number,
  fy: (t: number) => number,
  domain: { min: number; max: number },
): TrajectoryMarks | null {
  const tMin = domain.min;
  const tMax = domain.max;
  if (!(tMin < tMax)) return null;

  const launchY = fy(tMin);
  if (!Number.isFinite(launchY)) return null;

  const n = SCAN_STEPS;
  const step = (tMax - tMin) / (n - 1);
  const ys = new Array<number>(n);
  let anyFinite = false;
  for (let i = 0; i < n; i++) {
    const y = fy(tMin + step * i);
    ys[i] = Number.isFinite(y) ? y : NaN;
    if (Number.isFinite(y)) anyFinite = true;
  }
  if (!anyFinite) return null;

  // 峰值：域内极大（贴端即非物理峰值——上升段被截断 / 全程单调下沉）
  let iPeak = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(ys[i])) continue;
    if (iPeak < 0 || ys[i] > ys[iPeak]) iPeak = i;
  }
  if (iPeak <= 0 || iPeak >= n - 1) return null;

  // 黄金分割精化峰值（网格邻域内单峰；非有限值按 -Inf 处理不参与）
  const golden = 0.6180339887498949;
  let lo = tMin + step * (iPeak - 1);
  let hi = tMin + step * (iPeak + 1);
  const fySafe = (t: number): number => {
    const y = fy(t);
    return Number.isFinite(y) ? y : -Infinity;
  };
  let a = hi - golden * (hi - lo);
  let b = lo + golden * (hi - lo);
  for (let k = 0; k < REFINE_ITERATIONS && hi - lo > 1e-15; k++) {
    if (fySafe(a) < fySafe(b)) {
      lo = a;
      a = b;
      b = lo + golden * (hi - lo);
    } else {
      hi = b;
      b = a;
      a = hi - golden * (hi - lo);
    }
  }
  const tPeak = (lo + hi) / 2;
  const peakY = fy(tPeak);
  const height = peakY - launchY;
  if (!Number.isFinite(peakY) || !(height > 1e-9)) return null;
  const peakX = fx(tPeak);
  if (!Number.isFinite(peakX)) return null;

  // 落地：峰值后首个下行越零（fy 回落到抛出高度）→ 二分精化。容差 eps 吸收
  // 「域恰好截止在落地时刻」的浮点尾差（fy(T) ≈ ±1e-14，严格小于判定会漏检）
  const eps = 1e-9 * Math.max(1, Math.abs(launchY));
  let marks: TrajectoryMarks = {
    launch: { x: fx(tMin), y: launchY },
    peak: { x: peakX, y: peakY, height },
  };
  for (let i = iPeak; i < n - 1; i++) {
    if (!Number.isFinite(ys[i]) || !Number.isFinite(ys[i + 1])) continue;
    if (ys[i] >= launchY && ys[i + 1] < launchY + eps) {
      let loL = tMin + step * i;
      let hiL = tMin + step * (i + 1);
      for (let k = 0; k < REFINE_ITERATIONS; k++) {
        const mid = (loL + hiL) / 2;
        if (fy(mid) >= launchY) loL = mid;
        else hiL = mid;
      }
      const tLand = (loL + hiL) / 2;
      const landX = fx(tLand);
      if (Number.isFinite(landX)) {
        marks = { ...marks, landing: { x: landX, y: launchY, range: landX - fx(tMin) } };
      }
      break;
    }
  }
  return marks;
}

/** 峰值/落地标注点的绘制半径（局部 px，与 T2 切点标记同规格）。 */
export const PHYSICS_MARK_RADIUS_PX = 4;

/** 导引虚线节律（峰值垂线 / 射程水平线，局部 px；SVG 导出 join(',') 同款）。 */
export const PHYSICS_GUIDE_DASH: readonly number[] = [4, 4];
