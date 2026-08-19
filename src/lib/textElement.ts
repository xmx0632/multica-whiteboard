/**
 * 文本元素度量与工厂（ZOO-159）：
 *
 * 宽高一律按实际度量（canvas measureText），替换旧版 `content.length × fontSize × 0.6`
 * 粗估——创建 / 双击改内容 / 字号变更三处共用；行高与 renderer.drawText 的
 * `fontSize * 1.3` 保持同源（TEXT_LINE_HEIGHT），预览与落元素永不漂移。
 * 度量器以 `(text, font) => width` 注入：浏览器用离屏 canvas，node 单测退化
 * 为字符数估计（无 DOM 也可测、结果确定）。
 */
import { v4 as uuidv4 } from 'uuid';
import { TextElement, TEXT_MIN_FONT_SIZE, TEXT_MAX_FONT_SIZE } from './types';

/** 行高系数——renderer.drawText 绘制行距同源，改动须两处同步 */
export const TEXT_LINE_HEIGHT = 1.3;

/** 度量器：给定 css font 字符串返回文本宽度（px） */
export type TextWidthMeasurer = (text: string, font: string) => number;

/** css font 串（与 drawText 的 ctx.font 同构） */
export function textFont(fontSize: number, fontFamily: string): string {
  return `${fontSize}px ${fontFamily || 'sans-serif'}`;
}

/** node / 无 2D 上下文时的退化度量：字符数 × fontSize × 0.6（旧粗估口径，仅测试环境用） */
function fallbackMeasurer(text: string, font: string): number {
  const px = Number.parseFloat(font) || 20;
  return text.length * px * 0.6;
}

let sharedMeasurer: TextWidthMeasurer | null = null;

/** 惰性共享度量器：浏览器离屏 canvas measureText；不可用则退化估计 */
export function createTextMeasurer(): TextWidthMeasurer {
  if (sharedMeasurer) return sharedMeasurer;
  if (typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      sharedMeasurer = (text, font) => {
        ctx.font = font;
        return ctx.measureText(text).width;
      };
      return sharedMeasurer;
    }
  }
  sharedMeasurer = fallbackMeasurer;
  return sharedMeasurer;
}

export interface TextContentInput {
  content: string;
  fontSize: number;
  fontFamily: string;
}

/** 多行实宽度（最长行）/ 实高度（行数 × 行高）——空串宽为 0 */
export function measureTextElement(
  input: TextContentInput,
  measure: TextWidthMeasurer = createTextMeasurer()
): { width: number; height: number } {
  const lines = input.content.split('\n');
  const font = textFont(input.fontSize, input.fontFamily);
  const lineHeight = input.fontSize * TEXT_LINE_HEIGHT;
  const width = lines.reduce((max, line) => Math.max(max, measure(line, font)), 0);
  return { width, height: lineHeight * lines.length };
}

export interface TextElementInput {
  x: number;
  y: number;
  content: string;
  fontSize: number;
  color: string;
  fontFamily?: string;
}

/** T 工具落笔元素工厂：宽高实度量，strokeColor 与 color 同源（ZOO-157 面板双字段语义） */
export function createTextElement(
  input: TextElementInput,
  measure: TextWidthMeasurer = createTextMeasurer()
): TextElement {
  const fontFamily = input.fontFamily || 'sans-serif';
  const { width, height } = measureTextElement(
    { content: input.content, fontSize: input.fontSize, fontFamily },
    measure
  );
  return {
    id: uuidv4(),
    type: 'text',
    x: input.x,
    y: input.y,
    content: input.content,
    fontSize: input.fontSize,
    fontFamily,
    color: input.color,
    strokeColor: input.color,
    strokeWidth: 1,
    opacity: 1,
    width,
    height,
  };
}

/** 双击编辑确认补丁：内容 + 按新内容重测的宽高 */
export function textContentPatch(
  el: TextElement,
  content: string,
  measure: TextWidthMeasurer = createTextMeasurer()
): Pick<TextElement, 'content' | 'width' | 'height'> {
  const { width, height } = measureTextElement(
    { content, fontSize: el.fontSize, fontFamily: el.fontFamily },
    measure
  );
  return { content, width, height };
}

/**
 * 角控点等比缩放（ZOO-159：拖角控点改字号）。
 *
 * scale 为外框缩放比，fontSize 随之等比（先夹取到 [TEXT_MIN, MAX]_FONT_SIZE，
 * 再按实际生效的字号比例反推宽高——夹取后比例仍自洽，不会出现小字号配大外框）。
 * nw 控点锚定右下角（x/y 随缩放联动），se 锚定左上角，ne/sw 取主导轴近似。
 */
export function textScalePatch(el: TextElement, scale: number): Pick<TextElement, 'fontSize' | 'width' | 'height'> {
  const clamped = Math.min(TEXT_MAX_FONT_SIZE, Math.max(TEXT_MIN_FONT_SIZE, el.fontSize * scale));
  const applied = clamped / el.fontSize;
  return {
    fontSize: clamped,
    width: el.width * applied,
    height: el.height * applied,
  };
}

/** 控点缩放几何（世界坐标）：对角锚定 + 最小字号下限，输出可直接合入元素的补丁 */
export function textResizePatch(
  handle: 'nw' | 'ne' | 'sw' | 'se',
  startEl: TextElement,
  world: { x: number; y: number }
): Pick<TextElement, 'x' | 'y' | 'fontSize' | 'width' | 'height'> {
  const right = startEl.x + startEl.width;
  const bottom = startEl.y + startEl.height;
  // 各角拖拽得到的候选外框宽（到锚定对角的水平距离；拖过头取 0 → 由字号下限兜底）
  const wFrom = {
    nw: right - world.x,
    ne: world.x - startEl.x,
    sw: right - world.x,
    se: world.x - startEl.x,
  }[handle];
  const hFrom = {
    nw: bottom - world.y,
    ne: world.y - startEl.y,
    sw: world.y - startEl.y,
    se: world.y - startEl.y,
  }[handle];
  // 等比语义：宽 / 高折算比例取更接近拖拽意图（变化大者）的一侧，与 mathPlot equalRatio 同构
  const wScale = Math.max(0, wFrom) / (startEl.width || 1);
  const hScale = Math.max(0, hFrom) / (startEl.height || 1);
  const scale = Math.abs(wScale - 1) >= Math.abs(hScale - 1) ? wScale : hScale;
  const { fontSize, width, height } = textScalePatch(startEl, scale);

  const x = handle.includes('w') ? right - width : startEl.x;
  const y = handle.includes('n') ? bottom - height : startEl.y;
  return { x, y, fontSize, width, height };
}
