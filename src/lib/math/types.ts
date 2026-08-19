/**
 * MathPlot 方程模块共享契约。
 *
 * 本文件先于解析（ZOO-134）落地：按技术方案 §7.2 「先定接口再写 UI」的原则，
 * 这里固定编辑器/参数面板与未来解析层之间的类型边界：
 * - StructuralOutcome：4a 结构校验（validate.ts）的返回，explicit 暂无求值函数；
 * - ParseResult：4b mathjs 安全解析（parse.ts）须满足的完整契约（含 fn）；
 * - Polyline / MathViewport：采样折线与数学视窗，MiniPreview 与 4c 采样（sample.ts）共用。
 */
import type { Point } from '../types';

export type EquationKind = 'explicit' | 'line' | 'linePair' | 'point' | 'parabola' | 'hyperbola' | 'circle' | 'ellipse' | 'error';

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

/** 4a 结构校验结果（validateEquation 的返回）。错误文案沿用交互原型五类。 */
export type StructuralOutcome =
  | { kind: 'explicit' }
  | { kind: 'line'; params: LineParams }
  | { kind: 'linePair'; params: LinePairParams }
  | { kind: 'point'; params: DegeneratePointParams }
  | { kind: 'parabola'; params: ParabolaParams }
  | { kind: 'hyperbola'; params: HyperbolaParams }
  | { kind: 'circle'; params: CircleParams }
  | { kind: 'ellipse'; params: EllipseParams }
  | { kind: 'error'; message: string; fix?: string };

/**
 * 4b 解析契约（mathjs parse→compile，禁 eval）。explicit 在此基础上补齐求值函数。
 * ZOO-166：error 分支可选携带 fix（一键修正候选方程，如 y=4z → y=4x），
 * 编辑器据此渲染「改为 y=4x」替换 chip；旧消费方只读 message，零迁移。
 */
export type ParseResult =
  | { kind: 'explicit'; fn: (x: number) => number }
  | { kind: 'line'; params: LineParams }
  | { kind: 'linePair'; params: LinePairParams }
  | { kind: 'point'; params: DegeneratePointParams }
  | { kind: 'parabola'; params: ParabolaParams }
  | { kind: 'hyperbola'; params: HyperbolaParams }
  | { kind: 'circle'; params: CircleParams }
  | { kind: 'ellipse'; params: EllipseParams }
  | { kind: 'error'; message: string; fix?: string };

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

/** 方程确认（回车 / 插入按钮）时编辑器向外提交的载荷。
 *  kind 为 'error' 时同样允许确认 —— 4d 据此生成错误占位元素（交互原型决策 4）。 */
export interface EquationDraftPayload {
  equation: string;
  outcome: StructuralOutcome;
}
