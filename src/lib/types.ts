import type { MathPlotOverlay, MathPoiAnnotation } from './math/types';
import type { ConstantSliderMap } from './math/slider';

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

/**
 * 折线顶点（ZOO-168）：可选——无 points 或 ≤2 顶点即两点退化直线（旧文档天然等价）。
 * points[0] 镜像起点 x/y、末位镜像终点 x2/y2，>2 顶点为折线形态；两端字段与
 * 首尾顶点的一致性由 polyline.ts 的 polylinePatch 统一维护（增删 / 拖动顶点
 * 均产出完整补丁，不出现双数据源漂移）。
 */
export interface LinearVertices {
  points?: Point[];
}

export interface LineElement extends BaseElement, LinearVertices {
  type: 'line';
  x2: number;
  y2: number;
}

export interface ArrowElement extends BaseElement, LinearVertices {
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
  /**
   * ZOO-191（T4）：parametric（x=f(t),y=g(t)）/ polar（r=f(θ)）新 kind。
   * xAxis 字段复用为参数 t/θ 域（缺省 [0,2π]，高级公式面板参数式区编辑）；
   * equalRatio 强制 true（参数圆不画成椭圆，与几何 kind 同口径）。
   */
  kind: 'explicit' | 'line' | 'linePair' | 'point' | 'parabola' | 'hyperbola' | 'circle' | 'ellipse' | 'parametric' | 'polar' | 'error';
  /** kind === 'error' 时的用户可读原因 */
  error?: string | null;
  /**
   * 符号常量绑定（ZOO-188 T1）：键为存储层 ASCII 名（v0/theta/omega…），值参与
   * 显式路径符号三分法与求值 scope 注入；显示层经 constantDisplayName 还原原貌
   * （θ/ω/φ/v₀，见 math/normalize.ts）。缺省 = 无常量（行为与现状逐字节一致，
   * 旧文档零迁移）；空字典视为未启用（advancedFormulaState 判定口径）。
   */
  constants?: Record<string, number>;
  /**
   * 微积分叠加（ZOO-189 T2）：f′ 导函数叠加 / 切线演示（条目类型见
   * math/types.ts 的 MathPlotOverlay，开放式联合——T3 定积分将复用本字段追加
   * integral 形态）。缺省 / 空数组 = 无叠加（advancedFormulaState 判定口径，
   * 旧文档零迁移）；渲染层仅对显式函数生效，几何 / 错误态静默忽略、数据保留。
   */
  overlays?: MathPlotOverlay[];
  /**
   * POI 标注（ZOO-199）：点击灰点提示后持久化的坐标标注（零点 / 极值 / 交点，
   * 条目类型见 math/types.ts 的 MathPoiAnnotation）。缺省 / 空数组 = 无标注
   * （旧文档零迁移）；渲染层仅对显式函数生效，其余 kind 数据保留、不绘制；
   * 随元素序列化并出现在 SVG 导出，撤销 / 重做按整元素快照天然兼容。
   */
  poiAnnotations?: MathPoiAnnotation[];
  /**
   * 常量滑块元数据（ZOO-197）：键为存储层常量名（constants 的子集），值为
   * min/max/step（math/slider.ts 的 ConstantSliderMeta）。仅存用户自定义过的
   * 条目——缺省 / 无条目的常量播放与拖动一律回落 DEFAULT_SLIDER（-10~10、
   * 0.1），旧文档零迁移；常量移除时对应条目同步剔除，元素不留悬挂键。
   */
  constantSliders?: ConstantSliderMap;

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

/**
 * 分页帧元素（ZOO-198）：一节课的板书按页组织的容器，语义同 Miro / Excalidraw frame。
 *
 * x/y/width/height 为世界 px 外框；name 为页名（如「第 1 页 · 二次函数导入」）。
 * 帧渲染在底图层（全部内容元素之下，Canvas 渲染前先分区），不遮挡内容；
 * 页内元素不落字段——归属按「元素包围盒中心落在帧内」动态推导（frame.ts），
 * 旧文档无帧天然零迁移。elements 数组中帧的相对顺序即页序。
 */
export interface FrameElement extends BaseElement {
  type: 'frame';
  width: number;
  height: number;
  name: string;
}

export type WhiteboardElement =
  | PathElement
  | RectangleElement
  | CircleElement
  | LineElement
  | ArrowElement
  | TextElement
  | MathPlotElement
  | FrameElement;

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
  /**
   * 数据模型版本（技术方案 §5.3）。v2 = 分页帧（ZOO-198）：新增 frame 元素类型。
   * 旧文档（缺省 / v1）读作 1：无帧元素，打开 / 编辑 / 保存行为零变化；
   * 保存时写 CURRENT_SCHEMA_VERSION，不含帧的旧文档仅版本号递增、内容不变。
   */
  schemaVersion?: number;
}

/** 当前数据模型版本：v2 起含分页帧元素（ZOO-198） */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * 撤销 / 重做操作（ZOO-183 扩展 reorder）。
 * reorder 专用 beforeElements / afterElements 为完整元素数组快照——数组序即渲染
 * 层级，undo / redo 整体恢复；元素对象不可变（改动一律换新对象），快照仅持引用。
 */
export interface Operation {
  type: 'create' | 'update' | 'delete' | 'reorder';
  elementId: string;
  before?: WhiteboardElement;
  after?: WhiteboardElement;
  /** reorder：调整前的元素数组（含全部元素，顺序即层级） */
  beforeElements?: WhiteboardElement[];
  /** reorder：调整后的元素数组（与 beforeElements 同元素集、异序） */
  afterElements?: WhiteboardElement[];
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
