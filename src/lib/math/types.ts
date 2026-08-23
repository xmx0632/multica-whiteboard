/**
 * MathPlot 方程模块共享契约。
 *
 * 本文件先于解析（ZOO-134）落地：按技术方案 §7.2 「先定接口再写 UI」的原则，
 * 这里固定编辑器/参数面板与未来解析层之间的类型边界：
 * - StructuralOutcome：4a 结构校验（validate.ts）的返回，explicit 暂无求值函数；
 * - ParseResult：4b mathjs 安全解析（parse.ts）须满足的完整契约（含 fn）；
 * - MathPlotOverlay：T2 起的微积分叠加条目（calculus.ts / plot.ts / 面板共用）；
 * - Polyline / MathViewport：采样折线与数学视窗，MiniPreview 与 4c 采样（sample.ts）共用。
 */
import type { Point } from '../types';

/**
 * ZOO-191（T4）：parametric（x=f(t),y=g(t) 顶层逗号双等式）与 polar（r= 前缀）。
 * 求值函数约定与 explicit 同款——异常 / 非 number 返回 NaN（采样期按断笔处理）。
 */
export type EquationKind =
  | 'explicit'
  | 'line'
  | 'linePair'
  | 'point'
  | 'parabola'
  | 'hyperbola'
  | 'circle'
  | 'ellipse'
  | 'parametric'
  | 'polar'
  | 'error';

/** 二元一次方程一般式 ax+by=c 的探针系数（ZOO-146 / D7，含 b=0 竖线）。 */
export interface LineParams {
  a: number;
  b: number;
  c: number;
}

/**
 * 抛物线探针参数（ZOO-147 / D7）：axis='x' 即 (y−k)²=4p(x−h)（沿 x 轴开口），
 * axis='y' 即 (x−h)²=4p(y−k)。p 带符号，符号即开口方向，覆盖平移 + 四方向。
 * ZOO-149 增 rotation：开口对称轴相对 x 轴的旋转角（弧度，标准形 X' 轴方向），
 * 含 xy 交叉项的旋转抛物线用它；缺省 = 轴对齐（既有元素零迁移）。
 */
export interface ParabolaParams {
  /** 顶点 */
  h: number;
  k: number;
  /** 焦参数（顶点到焦点的带符号距离） */
  p: number;
  /** 开口轴向：'x' 左右开 / 'y' 上下开（旋转形取对称轴最近的方向） */
  axis: 'x' | 'y';
  /** 开口对称轴旋转角（弧度）；缺省 = 轴对齐 */
  rotation?: number;
}

/**
 * 双曲线探针参数（ZOO-147 / D7）：axis='x' 即 (x−h)²/a²−(y−k)²/b²=1，
 * axis='y' 即 (y−k)²/a²−(x−h)²/b²=1（a 恒为实半轴），含平移。
 * ZOO-149 增 rotation：实半轴 a 所在轴（标准形 X' 轴）相对 x 轴的旋转角
 * （弧度），含 xy 交叉项的旋转双曲线用它；缺省 = 轴对齐。
 */
export interface HyperbolaParams {
  /** 中心 */
  h: number;
  k: number;
  /** 实半轴（焦点所在轴） */
  a: number;
  /** 虚半轴 */
  b: number;
  /** 实轴方向 */
  axis: 'x' | 'y';
  /** 实轴旋转角（弧度）；缺省 = 轴对齐 */
  rotation?: number;
}

/**
 * 退化直线对参数（ZOO-148 / D7）：二次方程退化为两条直线（重合时只留一条）。
 * 相交（δ>0 且 K≈0，如 x²−y²=0）/ 平行（抛物线型缺轴向项且两实根，如 x²=4）/
 * 重合（判别式≈0，如 (x−1)²=0）。
 */
export interface LinePairParams {
  /** 退化出的直线（一般式系数）；重合时长度 1 */
  lines: LineParams[];
  /** 退化形态（面板文案与教学 detail 分支） */
  mode: 'intersecting' | 'parallel' | 'coincident';
}

/** 退化单点参数（ZOO-148 / D7）：椭圆型 K≈0（如 x²+y²=0 → 点 (0,0)）。 */
export interface DegeneratePointParams {
  x: number;
  y: number;
}

export interface CircleParams {
  cx: number;
  cy: number;
  r: number;
}

/**
 * 椭圆参数：标准形（detectGeometry 快路径）与一般形 / 旋转形（ZOO-149 隐式
 * 分类器）共用。rotation 为 rx 所在轴（标准形 X' 轴）相对 x 轴的旋转角
 * （弧度）；缺省 = 轴对齐（既有元素零迁移）。
 */
export interface EllipseParams {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** rx 轴旋转角（弧度）；缺省 = 轴对齐 */
  rotation?: number;
}

/**
 * 4a 结构校验结果（validateEquation 的返回）。错误文案沿用交互原型五类
 * （ZOO-176 起文案经注入翻译器随语言，见 parse.ts / i18n/lib.ts）。
 * ZOO-166 方案 A：explicit 携带 variable（自变量字母，缺省即 x）——任意单字母
 * 可作自变量（y=4z ⟂ y=4x 同一条直线），图形与变量命名无关。
 */
export type StructuralOutcome =
  | { kind: 'explicit'; variable?: string }
  | { kind: 'line'; params: LineParams }
  | { kind: 'linePair'; params: LinePairParams }
  | { kind: 'point'; params: DegeneratePointParams }
  | { kind: 'parabola'; params: ParabolaParams }
  | { kind: 'hyperbola'; params: HyperbolaParams }
  | { kind: 'circle'; params: CircleParams }
  | { kind: 'ellipse'; params: EllipseParams }
  | { kind: 'parametric'; variable?: string }
  | { kind: 'polar'; variable?: string }
  | { kind: 'error'; message: string };

/**
 * 4b 解析契约（mathjs parse→compile，禁 eval）。explicit 在此基础上补齐求值函数
 * 与自变量字母 variable（ZOO-166 方案 A；缺省即 x，非 x 时才携带）。
 */
export type ParseResult =
  | { kind: 'explicit'; fn: (x: number) => number; variable?: string }
  | { kind: 'line'; params: LineParams }
  | { kind: 'linePair'; params: LinePairParams }
  | { kind: 'point'; params: DegeneratePointParams }
  | { kind: 'parabola'; params: ParabolaParams }
  | { kind: 'hyperbola'; params: HyperbolaParams }
  | { kind: 'circle'; params: CircleParams }
  | { kind: 'ellipse'; params: EllipseParams }
  | { kind: 'parametric'; fx: (t: number) => number; fy: (t: number) => number; variable?: string }
  | { kind: 'polar'; fn: (theta: number) => number; variable?: string }
  | { kind: 'error'; message: string };

/** 采样折线（数学坐标，4c sample.ts 产物；MiniPreview / 主画布 / SVG 导出共用）。 */
export type Polyline = Point[];

/** 数学视窗（数学单位）。 */
export interface MathViewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** 预览数据（ZOO-134 采样管线产出）：折线 + 可选视窗提示（缺省由渲染方自适应）。 */
export interface PreviewData {
  polylines: Polyline[];
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
}

/**
 * 微积分叠加条目（ZOO-189 T2）：元素可选字段 overlays 的成员类型。
 * type 联合为开放式——T3（ZOO-190）已追加 `{ type: 'integral'; a; b }` 定积分
 * 形态、T4+ 按需扩展，均在本联合上并列增补，不改既有条目结构。
 * 渲染层仅对显式函数（kind === 'explicit'）生效；几何 / 错误态静默忽略、数据保留。
 */
export type MathPlotOverlay =
  | { type: 'derivative' }
  | { type: 'tangent'; x0: number }
  | { type: 'integral'; a: number; b: number };

/** 方程确认（回车 / 插入按钮）时编辑器向外提交的载荷。
 *  kind 为 'error' 时同样允许确认 —— 4d 据此生成错误占位元素（交互原型决策 4）。
 *  ZOO-188（T1）：constants 为编辑器常量草稿全量快照——undefined 表示本次流程
 *  无常量参与（不触碰元素既有绑定）；空字典表示显式清空（原位替换时清掉元素常量）。
 *  ZOO-189（T2）：overlays 语义与 constants 对齐——undefined 不触碰、数组（含空）
 *  为全量快照（空数组 = 显式清空，落元素前归一为 undefined）。
 *  ZOO-191（T4）：domain 为参数式 / 极坐标的参数域草稿（元素 xAxis 字段复用为
 *  t/θ 域）——undefined 表示未触碰（创建落默认 [0,2π]，原位替换保持元素现值）。 */
export interface EquationDraftPayload {
  equation: string;
  outcome: StructuralOutcome;
  constants?: Record<string, number>;
  overlays?: MathPlotOverlay[];
  domain?: { min: number; max: number };
}
