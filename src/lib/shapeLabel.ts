/**
 * 形状中心文字标签纯函数库（ZOO-232 L1）：
 *
 * 补丁 / 度量 / 垂直居中几何的单一计算源——renderer 绘制与本段起（L3 导出）
 * 共一份，Canvas ctx 操作留在 renderer。度量复用 textElement.ts 的
 * measureTextElement + TEXT_LINE_HEIGHT（行高同源，预览与渲染不漂移）；
 * 度量器注入同其模式（node 单测走退化估计，无 DOM 结果确定）。
 */
import { Labeled, ShapeLabel, TEXT_MIN_FONT_SIZE, TEXT_MAX_FONT_SIZE } from './types';
import { createTextMeasurer, measureTextElement, TextWidthMeasurer, TEXT_LINE_HEIGHT } from './textElement';

/** 标签字体：不落 fontFamily 字段，度量与渲染共用此常量（两处永不漂移） */
export const SHAPE_LABEL_FONT_FAMILY = 'sans-serif';

/** 初始字号系数：min 边 × 0.3（正方形 100×100 → 30px） */
const INITIAL_FONT_SIZE_RATIO = 0.3;

/**
 * 双击落笔初始字号：clamp(round(min(|w|, |h|) × 0.3), TEXT_MIN, TEXT_MAX)。
 * 负宽高取绝对值——翻转拖拽中传入的中间态不变式；min 边过小 / 过大由字号
 * 边界夹取兜底（与 text 角控点缩放同界）。
 */
export function initialLabelFontSize(w: number, h: number): number {
  const shortest = Math.min(Math.abs(w), Math.abs(h));
  return Math.min(
    TEXT_MAX_FONT_SIZE,
    Math.max(TEXT_MIN_FONT_SIZE, Math.round(shortest * INITIAL_FONT_SIZE_RATIO))
  );
}

/** 标签实度量（多行最长行宽 / 行数 × 行高）——textElement 同一口径 */
export function measureShapeLabel(
  label: ShapeLabel,
  measure: TextWidthMeasurer = createTextMeasurer()
): { width: number; height: number } {
  return measureTextElement(
    { content: label.content, fontSize: label.fontSize, fontFamily: SHAPE_LABEL_FONT_FAMILY },
    measure
  );
}

/** labelPatch 入参宿主的最小结构（rectangle / circle / diamond 均满足） */
type LabelHost = Labeled & { width: number; height: number; strokeColor: string };

/** labelPatch 可选覆盖项：字号 / 颜色（缺省沿用现值或初始推导值） */
export interface LabelPatchOptions {
  fontSize?: number;
  color?: string;
}

/**
 * 标签变更补丁（浅合并语义，供 store.updateElement 直用）：
 * - content 为空串 → `{ label: undefined }` 清除——store Object.assign 浅合并
 *   后 JSON.stringify 丢弃 undefined 键，序列化即净清除（已验证直通）；
 * - 首次落笔（el 无 label）：字号 = initialLabelFontSize(w, h)，颜色 = 当时
 *   描边色快照（此后与描边色解耦，见 ShapeLabel 注释）；
 * - 非首次：沿用现字号 / 现颜色，opts 显式覆盖才变。
 */
export function labelPatch(
  el: LabelHost,
  content: string,
  opts?: LabelPatchOptions
): { label: ShapeLabel | undefined } {
  if (content === '') return { label: undefined };
  const prev: ShapeLabel = el.label ?? {
    content: '',
    fontSize: initialLabelFontSize(el.width, el.height),
    color: el.strokeColor,
  };
  return {
    label: {
      content,
      fontSize: opts?.fontSize ?? prev.fontSize,
      color: opts?.color ?? prev.color,
    },
  };
}

/** 标签行序列（'\n' 拆分，与 drawText 多行同口径；空串 → ['']） */
export function labelLines(label: ShapeLabel): string[] {
  return label.content.split('\n');
}

/** 标签行高（世界 px）：fontSize × TEXT_LINE_HEIGHT——度量与绘制同源 */
export function labelLineHeight(label: ShapeLabel): number {
  return label.fontSize * TEXT_LINE_HEIGHT;
}

/**
 * 垂直居中首行 top（textBaseline='top' 口径）：文本块中心 = 形状中心——
 * `cy - lineHeight × lineCount / 2`。首行 top 与末行 bottom 关于 cy 对称，
 * 奇 / 偶行数同式（无半行偏移特判）。
 */
export function labelFirstLineTop(cy: number, lineHeight: number, lineCount: number): number {
  return cy - (lineHeight * lineCount) / 2;
}
