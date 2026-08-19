export type ToolType = 'hand' | 'select' | 'pen' | 'rectangle' | 'circle' | 'line' | 'arrow' | 'text' | 'eraser' | 'equation';

export interface Point {
  x: number;
  y: number;
}

/**
 * 描边线型（ZOO-165）：solid 实线 / dashed 虚线 / dotted 点线。
 * 可选字段——旧文档无 dash 视为 solid（渲染 / 面板读取统一走 stroke.ts 的 elementDash）。
 */
export type StrokeDashStyle = 'solid' | 'dashed' | 'dotted';

export interface BaseElement {
  id: string;
  type: string;
  x: number;
  y: number;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  /** 线型（ZOO-165）：缺省 = solid；仅描边类元素（path/rect/circle/line/arrow）渲染读取 */
  dash?: StrokeDashStyle;
}

export interface PathElement extends BaseElement {
  type: 'path';
  points: Point[];
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  width: number;
  height: number;
  fillColor: string | null;
}

export interface CircleElement extends BaseElement {
  type: 'circle';
  width: number;
  height: number;
  fillColor: string | null;
}

export interface LineElement extends BaseElement {
  type: 'line';
  x2: number;
  y2: number;
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  x2: number;
  y2: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  content: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  width: number;
  height: number;
}

/**
 * 数学图形元素（技术方案 §5.1 数据模型，ZOO-136 集成）。
 *
 * 外框语义同 rectangle（x/y 为左上角、width/height 为世界 px）——命中 / 选中 /
 * 移动 / 导出包围盒全部复用外框。y 视窗与原点不落字段：4c 渲染管线
 * （resolvePlotRender）按 equalRatio + 外框纵横比推导 y 视窗、原点固定 (0,0)，
 * 折线 / Path2D 等运行时态走 math/cache.ts 的旁路缓存，序列化保持纯数据。
 */
export interface MathPlotElement extends BaseElement {
  type: 'mathPlot';
  width: number;
  height: number;

  // —— 方程 ——
  equation: string;
  kind: 'explicit' | 'line' | 'linePair' | 'point' | 'parabola' | 'hyperbola' | 'circle' | 'ellipse' | 'error';
  /** kind === 'error' 时的用户可读原因 */
  error?: string | null;

  // —— 数学视窗（局部坐标系定义，数学单位）——
  xAxis: { min: number; max: number };
  /** x/y 单位等比；几何 kind（line/linePair/point/parabola/hyperbola/circle/ellipse）强制 true（不失真） */
  equalRatio: boolean;

  // —— 绘制参数 ——
  sampleCount: 160 | 320 | 640;
  showAxis: boolean;
  showGrid: boolean;
  showLabel: boolean;
}

export type WhiteboardElement =
  | PathElement
  | RectangleElement
  | CircleElement
  | LineElement
  | ArrowElement
  | TextElement
  | MathPlotElement;

export interface Viewport {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface WhiteboardDocument {
  id: string;
  title: string;
  elements: WhiteboardElement[];
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  /** 数据模型版本占位（技术方案 §5.3）：当前不写值，为未来迁移预留 */
  schemaVersion?: number;
}

export interface Operation {
  type: 'create' | 'update' | 'delete';
  elementId: string;
  before?: WhiteboardElement;
  after?: WhiteboardElement;
}

export const COLORS = [
  '#000000', '#FFFFFF', '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#14B8A6', '#3B82F6', '#6366F1', '#A855F7', '#EC4899', '#78716C',
];

export const DEFAULT_STROKE_COLOR = '#000000';
export const DEFAULT_STROKE_WIDTH = 2;
export const DEFAULT_STROKE_DASH: StrokeDashStyle = 'solid';
export const DEFAULT_FONT_SIZE = 20;
/** 字号边界（ZOO-159）：角控点缩放 / 字号滑杆共用下限上限 */
export const TEXT_MIN_FONT_SIZE = 10;
export const TEXT_MAX_FONT_SIZE = 200;

// —— MathPlot 元素默认常量（技术方案 §8 创建落点；原型基线曲线色 #3B82F6）——
export const MATHPLOT_DEFAULT_WIDTH = 480;
export const MATHPLOT_DEFAULT_HEIGHT = 360;
/** 8 控点拖拽缩放的最小外框（世界 px；屏幕最小值由 Canvas 按 scale 换算加严） */
export const MATHPLOT_MIN_WIDTH = 120;
export const MATHPLOT_MIN_HEIGHT = 90;
export const MATHPLOT_CURVE_COLOR = '#3B82F6';
export const DEFAULT_MATHPLOT = {
  width: MATHPLOT_DEFAULT_WIDTH,
  height: MATHPLOT_DEFAULT_HEIGHT,
  xAxis: { min: -10, max: 10 },
  sampleCount: 320,
  equalRatio: true,
  showAxis: true,
  showGrid: true,
  showLabel: true,
  strokeColor: MATHPLOT_CURVE_COLOR,
  strokeWidth: 2,
  opacity: 1,
} as const;
