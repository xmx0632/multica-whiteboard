import { StrokeDashStyle, WhiteboardElement } from './types';

/**
 * 选中改色补丁（ZOO-157）：颜色面板作用于选中元素时按类型取字段。
 *
 * text 的渲染色是 `color`（renderer.ts fillStyle），创建时与 strokeColor 同源；
 * 改色两处同步，避免「面板显示已改、画布仍是旧色」。mathPlot 有专属参数面板
 * （MathPlotParams），不经此通道——由调用方在选中 mathPlot 时跳过。
 */
export function strokeColorPatch(el: WhiteboardElement, color: string): Partial<WhiteboardElement> {
  return el.type === 'text'
    ? { strokeColor: color, color }
    : { strokeColor: color };
}

/** 选中元素是否可经默认面板改色 / 改线宽（mathPlot 走专属面板，保持不回归） */
export function canRestyleFromToolPanel(el: WhiteboardElement | null | undefined): el is Exclude<WhiteboardElement, { type: 'mathPlot' }> {
  return el != null && el.type !== 'mathPlot';
}

/** 元素当前渲染色（text 为 color，其余为 strokeColor）——面板高亮与手势收尾判变共用 */
export function elementStrokeColor(el: WhiteboardElement): string {
  return el.type === 'text' ? el.color : el.strokeColor;
}

/**
 * 选中元素是否可经默认面板改线型（ZOO-165）：仅描边类元素——path /
 * rectangle / circle / line / arrow。text 无描边、mathPlot 走专属参数面板，
 * 均不参与（选中它们时面板不渲染线型区）。
 */
export function canDashFromToolPanel(el: WhiteboardElement | null | undefined): el is Exclude<WhiteboardElement, { type: 'text' | 'mathPlot' }> {
  return el != null && ['path', 'rectangle', 'circle', 'line', 'arrow'].includes(el.type);
}

/** 元素当前线型：dash 缺省（旧文档）读作 solid——渲染 / 面板回显统一入口 */
export function elementDash(el: WhiteboardElement): StrokeDashStyle {
  return el.dash ?? 'solid';
}

/**
 * 线型 → dash 数组（世界 px，按线宽比例，ZOO-165）：solid 返回空数组（实线，
 * 调用方跳过 setLineDash / stroke-dasharray）。虚线段与间隔、点线间隔均随
 * 线宽缩放——高缩放 / 粗线下视觉密度稳定。dotted 用近零长 dash 段 + round
 * lineCap 出圆点（canvas / SVG 同语义）。
 */
export function dashPatternFor(dash: StrokeDashStyle | undefined, strokeWidth: number): number[] {
  switch (dash) {
    case 'dashed':
      return [strokeWidth * 4, strokeWidth * 3];
    case 'dotted':
      return [0.2, strokeWidth * 2.4];
    default:
      return [];
  }
}
