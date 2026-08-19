import { WhiteboardElement } from './types';

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
