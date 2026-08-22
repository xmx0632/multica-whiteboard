/**
 * MathPlot 元素工厂（ZOO-136 集成，技术方案 §8 创建落点）。
 *
 * 由方程编辑器的确认载荷（EquationDraftPayload）生成 / 原位更新
 * MathPlotElement：错误态同样建元素（交互原型决策 4，可移动 / 删除 / 撤销）；
 * 几何方程（直线 / 圆 / 椭圆）强制 equalRatio，定义域取采样包围盒（等比卡片取纵横比）。
 */
import { v4 as uuidv4 } from 'uuid';
import { zhT, type LibT } from '../i18n/lib';
import { sampleGeometry } from './math/sample';
import { validateEquation } from './math/validate';
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
  outcome:
    | { kind: 'line'; params: { a: number; b: number; c: number } }
    | { kind: 'linePair'; params: { lines: { a: number; b: number; c: number }[]; mode: 'intersecting' | 'parallel' | 'coincident' } }
    | { kind: 'point'; params: { x: number; y: number } }
    | { kind: 'parabola'; params: { h: number; k: number; p: number; axis: 'x' | 'y'; rotation?: number } }
    | { kind: 'hyperbola'; params: { h: number; k: number; a: number; b: number; axis: 'x' | 'y'; rotation?: number } }
    | { kind: 'circle'; params: { cx: number; cy: number; r: number } }
    | { kind: 'ellipse'; params: { cx: number; cy: number; rx: number; ry: number; rotation?: number } }
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
  /**
   * ZOO-188（T1）：仅当载荷携带常量草稿（payload.constants !== undefined）时出现——
   * 非空字典为全量快照，空字典表示显式清空（原位替换流）；undefined 不触碰元素既有绑定。
   */
  constants?: Record<string, number>;
}

export function mathPlotFieldsFromPayload(payload: EquationDraftPayload): MathPlotPatch {
  const outcome = payload.outcome;
  const base: MathPlotPatch = {
    equation: payload.equation,
    kind: outcome.kind,
    error: outcome.kind === 'error' ? outcome.message : null,
  };
  if (payload.constants !== undefined && Object.keys(payload.constants).length > 0) {
    base.constants = { ...payload.constants };
  } else if (payload.constants !== undefined) {
    base.constants = {};
  }
  if (
    outcome.kind === 'line' ||
    outcome.kind === 'linePair' ||
    outcome.kind === 'point' ||
    outcome.kind === 'parabola' ||
    outcome.kind === 'hyperbola' ||
    outcome.kind === 'circle' ||
    outcome.kind === 'ellipse'
  ) {
    return { ...base, ...geometryFields(outcome) };
  }
  return base;
}

/** 面板方程提交收敛结果（ZOO-155）：合法方程产出数学字段补丁；非法方程 fields 为 null 并携带原因。 */
export interface EquationCommitResult {
  fields: MathPlotPatch | null;
  /** fields === null 时的用户可读原因 */
  error?: string;
}

/**
 * 面板方程提交收敛（ZOO-155）：重新校验并回写分类 / 错误信息 / 几何定义域。
 * 非法方程返回 fields=null —— 调用方须回滚元素到手势前快照（保持原曲线），
 * 不得把 error 态写入既有元素（属性面板编辑路径，区别于编辑器建卡的错误占位流）。
 */
/** ZOO-176：t 透传（错误文案随语言；缺省中文与历史行为一致）。
 *  ZOO-188（T1）：constants 透传——面板调参提交收敛须按元素当前常量绑定裁决，
 *  否则含常量的合法方程（y=A·sin(ωx+φ)）会被误判非法而回滚。 */
export function convergeEquationCommit(equation: string, t: LibT = zhT, constants?: Record<string, number>): EquationCommitResult {
  const outcome = validateEquation(equation, t, constants);
  const trimmed = equation.trim();
  if (outcome.kind === 'error') return { fields: null, error: outcome.message };
  return { fields: mathPlotFieldsFromPayload({ equation: trimmed || equation, outcome }) };
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
    // ZOO-188（T1）：常量绑定随载荷落元素；空字典 / 缺省不落键（旧文档零迁移、无空壳）
    ...(fields.constants && Object.keys(fields.constants).length > 0 ? { constants: { ...fields.constants } } : {}),
  };
}
