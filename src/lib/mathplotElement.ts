/**
 * MathPlot 元素工厂（ZOO-136 集成，技术方案 §8 创建落点）。
 *
 * 由方程编辑器的确认载荷（EquationDraftPayload）生成 / 原位更新
 * MathPlotElement：错误态同样建元素（交互原型决策 4，可移动 / 删除 / 撤销）；
 * 几何方程（圆 / 椭圆）强制 equalRatio，定义域取采样包围盒（等比卡片取纵横比）。
 */
import { v4 as uuidv4 } from 'uuid';
import { sampleGeometry } from './math/sample';
import type { EquationDraftPayload } from './math/types';
import { DEFAULT_MATHPLOT, MathPlotElement } from './types';

export interface MathPlotPlacement {
  /** 元素外框中心（世界坐标） */
  centerX: number;
  centerY: number;
  /** 可视区约束（世界 px）：默认尺寸超出时按比例收缩，避免一插入就满屏 */
  maxWidth?: number;
  maxHeight?: number;
  /** 工具栏当前取值（技术方案 §8：strokeColor / strokeWidth 继承工具栏） */
  strokeColor?: string;
  strokeWidth?: number;
}

/** 几何方程附加字段：定义域取采样包围盒（等比卡片由外框纵横比保形）。 */
function geometryFields(
  outcome: { kind: 'circle'; params: { cx: number; cy: number; r: number } } | { kind: 'ellipse'; params: { cx: number; cy: number; rx: number; ry: number } }
): Pick<MathPlotElement, 'xAxis' | 'equalRatio'> {
  const bbox = sampleGeometry(outcome.kind, outcome.params);
  if ('error' in bbox) return { xAxis: { ...DEFAULT_MATHPLOT.xAxis }, equalRatio: true };
  return { xAxis: { min: bbox.xMin ?? -10, max: bbox.xMax ?? 10 }, equalRatio: true };
}

/** 方程载荷 → 数学字段补丁（原位替换时套在既有元素上，样式 / 位置不动；几何方程附定义域）。 */
export interface MathPlotPatch {
  equation: string;
  kind: MathPlotElement['kind'];
  error: string | null;
  xAxis?: { min: number; max: number };
  equalRatio?: boolean;
}

export function mathPlotFieldsFromPayload(payload: EquationDraftPayload): MathPlotPatch {
  const outcome = payload.outcome;
  const base: MathPlotPatch = {
    equation: payload.equation,
    kind: outcome.kind,
    error: outcome.kind === 'error' ? outcome.message : null,
  };
  if (outcome.kind === 'circle' || outcome.kind === 'ellipse') {
    return { ...base, ...geometryFields(outcome) };
  }
  return base;
}

/** 方程载荷 → 新元素（外框中心落点；默认 480×360，超出可视区时按比例收缩）。 */
export function createMathPlotElement(payload: EquationDraftPayload, place: MathPlotPlacement): MathPlotElement {
  const maxW = place.maxWidth && place.maxWidth > 0 ? place.maxWidth : Infinity;
  const maxH = place.maxHeight && place.maxHeight > 0 ? place.maxHeight : Infinity;
  const shrink = Math.min(1, maxW / DEFAULT_MATHPLOT.width, maxH / DEFAULT_MATHPLOT.height);
  const width = Math.max(DEFAULT_MATHPLOT.width * shrink, 1);
  const height = Math.max(DEFAULT_MATHPLOT.height * shrink, 1);
  const fields = mathPlotFieldsFromPayload(payload);

  return {
    id: uuidv4(),
    type: 'mathPlot',
    x: place.centerX - width / 2,
    y: place.centerY - height / 2,
    width,
    height,
    strokeColor: place.strokeColor ?? DEFAULT_MATHPLOT.strokeColor,
    strokeWidth: place.strokeWidth ?? DEFAULT_MATHPLOT.strokeWidth,
    opacity: DEFAULT_MATHPLOT.opacity,
    sampleCount: DEFAULT_MATHPLOT.sampleCount,
    showAxis: DEFAULT_MATHPLOT.showAxis,
    showGrid: DEFAULT_MATHPLOT.showGrid,
    showLabel: DEFAULT_MATHPLOT.showLabel,
    equalRatio: fields.equalRatio ?? DEFAULT_MATHPLOT.equalRatio,
    xAxis: fields.xAxis ? { ...fields.xAxis } : { ...DEFAULT_MATHPLOT.xAxis },
    equation: fields.equation,
    kind: fields.kind,
    error: fields.error,
  };
}
