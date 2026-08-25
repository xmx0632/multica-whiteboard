/**
 * 分页帧几何与页序纯函数（ZOO-198）：
 *
 * - 页序：elements 数组中 frame 元素的相对顺序即页序（重排 = 重排帧槽位，
 *   内容元素层级不动）；
 * - 归属：元素包围盒中心落在帧内即属该页（动态推导，不落字段，拖入即入页）；
 * - 联动：帧整体移动 / 缩放时页内元素跟随（translateElement / scaleFrameContents）；
 * - 对齐：frameFocusViewport 计算让整帧可见的视口（页条点击跳转的目标）；
 * - 导出：frameExportRegion = 帧矩形 + 上缘标题条（export.ts 按此裁剪）。
 *
 * 纯函数、不改入参；与 renderer.ts 互相只在函数体引用（模块顶层无调用，环安全）。
 */
import { v4 as uuidv4 } from 'uuid';
import {
  FrameElement,
  WhiteboardElement,
  Viewport,
  TEXT_MIN_FONT_SIZE,
  TEXT_MAX_FONT_SIZE,
} from './types';
import { elementBoundsAABB } from './renderer';
import { measureTextElement } from './textElement';
import { polylinePatch } from './polyline';

/** 新页默认尺寸（世界 px）：16:10-ish 板书页 */
export const FRAME_DEFAULT_WIDTH = 960;
export const FRAME_DEFAULT_HEIGHT = 640;
/** 页外框下限（世界 px）：角控点缩放兜底，防止拖成一条线 */
export const FRAME_MIN_WIDTH = 240;
export const FRAME_MIN_HEIGHT = 160;
/** 新页 / 复制页相对既有帧的横向排布间隙（世界 px） */
export const FRAME_GAP = 80;
/** 帧标题条高度（世界 px）：绘制在帧上缘外侧，导出裁剪区含此条 */
export const FRAME_TITLE_HEIGHT = 36;
/** 页条点击跳转后帧四周留白（屏幕 px） */
export const FOCUS_MARGIN = 72;

export function isFrame(el: WhiteboardElement): el is FrameElement {
  return el.type === 'frame';
}

/** 全部帧按页序（elements 数组序）取出 */
export function framesOf(elements: WhiteboardElement[]): FrameElement[] {
  return elements.filter(isFrame);
}

/**
 * 元素是否属于某帧：包围盒中心落在帧矩形内（帧之间中心不重叠，归属确定）。
 * ZOO-221 起取世界系 AABB（帧归属按视觉足迹；旋转元素中心两套包围盒数值
 * 相同——旋转绕几何中心，AABB 中心 = 几何中心）。
 */
export function elementInFrame(el: WhiteboardElement, frame: FrameElement): boolean {
  if (isFrame(el)) return false; // 帧不嵌套：帧永不属于另一帧
  const b = elementBoundsAABB(el);
  if (!b) return false;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return (
    cx >= frame.x && cx <= frame.x + frame.width &&
    cy >= frame.y && cy <= frame.y + frame.height
  );
}

/** 帧内内容元素（中心规则，不含其它帧）——页缩略图 / 页导出 / 联动跟随共用 */
export function frameContents(elements: WhiteboardElement[], frame: FrameElement): WhiteboardElement[] {
  return elements.filter((el) => elementInFrame(el, frame));
}

/**
 * 新帧落位：无帧 → 视口中心（viewSize 缺省按 1200×800 近似）；有帧 →
 * 最右帧右侧 + FRAME_GAP（教师从左往右翻页的心智模型）。
 */
export function nextFrameRect(
  frames: FrameElement[],
  viewport: Viewport,
  viewSize?: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const width = FRAME_DEFAULT_WIDTH;
  const height = FRAME_DEFAULT_HEIGHT;

  if (frames.length === 0) {
    const vw = viewSize?.width ?? 1200;
    const vh = viewSize?.height ?? 800;
    const cx = (vw / 2 - viewport.offsetX) / viewport.scale;
    const cy = (vh / 2 - viewport.offsetY) / viewport.scale;
    return { x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), width, height };
  }

  let rightmost = frames[0];
  for (const f of frames) {
    if (f.x + f.width > rightmost.x + rightmost.width) rightmost = f;
  }
  return {
    x: Math.round(rightmost.x + rightmost.width + FRAME_GAP),
    y: Math.round(rightmost.y),
    width,
    height,
  };
}

/**
 * 页条点击跳转的目标视口：整帧（含标题条）带 FOCUS_MARGIN 完整可见，
 * 缩放不超过 maxScale（防止小帧被过度放大）。
 */
export function frameFocusViewport(
  frame: FrameElement,
  viewWidth: number,
  viewHeight: number,
  maxScale = 1
): Viewport {
  const availW = Math.max(viewWidth - FOCUS_MARGIN * 2, 1);
  const availH = Math.max(viewHeight - FOCUS_MARGIN * 2, 1);
  const scale = Math.min(availW / frame.width, availH / (frame.height + FRAME_TITLE_HEIGHT), maxScale);
  // 帧中心对齐视口中心
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  return {
    scale,
    offsetX: Math.round(viewWidth / 2 - cx * scale),
    offsetY: Math.round(viewHeight / 2 - cy * scale),
  };
}

/**
 * 帧缩放联动（ZOO-198 验收「帧可整体缩放，帧内元素跟随」）：
 * 帧外框 before → after 时，页内元素按 (sx, sy) 比例跟随——位置锚定帧左上角缩放，
 * 尺寸类字段（外框 / 端点 / 顶点 / fontSize）同比例。strokeWidth 不缩（与 Miro 一致，
 * 线宽视觉稳定）。min 尺寸保证 sx / sy 恒正。
 */
export function scaleFrameContents(
  before: FrameElement,
  after: FrameElement,
  contents: WhiteboardElement[]
): WhiteboardElement[] {
  const sx = after.width / before.width;
  const sy = after.height / before.height;
  const px = (v: number) => after.x + (v - before.x) * sx;
  const py = (v: number) => after.y + (v - before.y) * sy;

  return contents.map((el): WhiteboardElement => {
    const moved = { ...el, x: px(el.x), y: py(el.y) } as WhiteboardElement;
    switch (moved.type) {
      case 'rectangle':
      case 'circle':
      case 'diamond':
      case 'mathPlot':
        return { ...moved, width: moved.width * sx, height: moved.height * sy };
      case 'line':
      case 'arrow': {
        const scaled = { ...moved, x2: px(moved.x2), y2: py(moved.y2) };
        return (moved.points && moved.points.length > 2)
          ? (polylinePatch(scaled, moved.points.map((p) => ({ x: px(p.x), y: py(p.y) }))) as WhiteboardElement)
          : (scaled as WhiteboardElement);
      }
      case 'path':
        return {
          ...moved,
          points: moved.points.map((p) => ({ x: px(p.x), y: py(p.y) })),
        };
      case 'text': {
        // fontSize 为标量：取纵横均值缩放并夹在字号边界内，宽高按度量重算
        const fs = Math.min(
          TEXT_MAX_FONT_SIZE,
          Math.max(TEXT_MIN_FONT_SIZE, moved.fontSize * ((sx + sy) / 2)),
        );
        const { width, height } = measureTextElement({
          content: moved.content, fontSize: fs, fontFamily: moved.fontFamily,
        });
        return { ...moved, fontSize: fs, width, height };
      }
      default:
        return moved;
    }
  });
}

/** 帧导出裁剪区：帧矩形向上扩 FRAME_TITLE_HEIGHT（标题随页导出） */
export function frameExportRegion(frame: FrameElement): { x: number; y: number; width: number; height: number } {
  return {
    x: frame.x,
    y: frame.y - FRAME_TITLE_HEIGHT,
    width: frame.width,
    height: frame.height + FRAME_TITLE_HEIGHT,
  };
}

/**
 * 复制页：帧 + 页内内容整体换新 id，落位在源帧右侧 + FRAME_GAP。
 * 内容随帧同位移（保持在新帧内同相对位置）；顺序保持源内容序
 * （append 到 elements 末尾即层级在顶，视觉不变）。
 */
export function duplicateFrameBundle(
  source: FrameElement,
  contents: WhiteboardElement[],
  name: string
): { frame: FrameElement; contents: WhiteboardElement[] } {
  const dx = source.width + FRAME_GAP;
  const frame: FrameElement = {
    ...source,
    id: uuidv4(),
    name,
    x: source.x + dx,
    y: source.y,
  };
  const copied = contents.map((el) => reIdShifted(el, dx, 0));
  return { frame, contents: copied };
}

/** 元素换新 id 并整体平移 dx/dy（多锚点类型逐字段同步，与 translateElement 同构） */
function reIdShifted(el: WhiteboardElement, dx: number, dy: number): WhiteboardElement {
  const shifted = { ...el, id: uuidv4(), x: el.x + dx, y: el.y + dy } as WhiteboardElement;
  switch (shifted.type) {
    case 'line':
    case 'arrow':
      return {
        ...shifted,
        x2: (el as { x2: number }).x2 + dx,
        y2: (el as { y2: number }).y2 + dy,
        ...(shifted.points ? { points: shifted.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : {}),
      } as WhiteboardElement;
    case 'path':
      return { ...shifted, points: shifted.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    default:
      return shifted;
  }
}

/**
 * 相邻页导航（ZOO-205 ←→ 翻页快捷键）：给定有序帧列表与当前活动页 id，
 * 返回上一页（dir=-1）/ 下一页（dir=+1）的帧；边界与空列表返回 null（空转）。
 *
 * activeId 悬空（撤销 / 删除后）或 null 时按首页（frames[0]）语义起算——
 * 与 PageBar 的 active 兜底（active ?? frames[0]）一致。
 */
export function neighborFrame(
  frames: FrameElement[],
  activeId: string | null,
  dir: 1 | -1,
): FrameElement | null {
  if (frames.length === 0) return null;
  const idx = Math.max(0, frames.findIndex((f) => f.id === activeId));
  const next = frames[idx + dir];
  return next ?? null;
}
