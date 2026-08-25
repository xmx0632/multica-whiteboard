/**
 * 图形元素选中缩放几何（ZOO-160）：
 *
 * - rect / circle / diamond：4 角控点改外框 width/height（对角锚定，数据模型同 rectangle
 *   外框语义；circle 为椭圆包围盒、diamond 顶点由外框中点推导，缩放即改包围盒——对角锚定与 rect 一致）；
 * - line / arrow：端点手柄 p1/p2 直接改锚点坐标（选中后可直接改端点）；
 * - path：包围盒角控点整体等比缩放点集（对角锚定，笔迹形状不变形）。
 *
 * 纯函数：不改原元素，返回可直接合入元素的补丁（与 textResizePatch / applyResize 同构）。
 */
import { WhiteboardElement, RectangleElement, CircleElement, DiamondElement, LineElement, ArrowElement, PathElement, FrameElement } from './types';
import { elementLocalFrame } from './renderer';
import { lineVertices, polylinePatch, isPolyline } from './polyline';

/** 角控点方位（rect/circle/path 共用；mathPlot 8 控点的角子集） */
export type CornerHandle = 'nw' | 'ne' | 'sw' | 'se';

/** 缩放下限（世界 px；Canvas 按 viewport.scale 加严屏幕侧下限后传入） */
export const SHAPE_MIN_SIZE = 8;

export interface ResizeOpts {
  /** Shift 按住 → 等比锁定（纵横比取起手元素） */
  shift?: boolean;
  /** 外框最小边（世界 px），默认 SHAPE_MIN_SIZE */
  minSize?: number;
}

/**
 * 角控点外框缩放（rect/circle/diamond/frame）：拖拽侧自由、对角锚定，最小边兜底（拖过头收在
 * minSize，不翻转——与 mathPlot applyResize 同构）。shift → 等比锁定，主导轴优先
 * （x/y 变化折算取更接近拖拽意图的一侧，与 mathPlot equalRatio / textResizePatch 同构）。
 */
export function boxResizePatch(
  handle: CornerHandle,
  startEl: RectangleElement | CircleElement | DiamondElement | FrameElement,
  world: { x: number; y: number },
  opts?: ResizeOpts
): Pick<RectangleElement, 'x' | 'y' | 'width' | 'height'> {
  const min = opts?.minSize ?? SHAPE_MIN_SIZE;
  let left = startEl.x;
  let top = startEl.y;
  let right = startEl.x + startEl.width;
  let bottom = startEl.y + startEl.height;

  if (handle.includes('w')) left = Math.min(world.x, right - min);
  if (handle.includes('e')) right = Math.max(world.x, left + min);
  if (handle.includes('n')) top = Math.min(world.y, bottom - min);
  if (handle.includes('s')) bottom = Math.max(world.y, top + min);

  let width = right - left;
  let height = bottom - top;

  if (opts?.shift && startEl.width > 0 && startEl.height > 0) {
    const aspect = startEl.height / startEl.width;
    if (Math.abs(width - startEl.width) >= Math.abs(height - startEl.height) / (aspect || 1)) {
      height = width * aspect;
    } else {
      width = height / (aspect || 1);
    }
    if (handle.includes('n')) top = bottom - height;
    else bottom = top + height;
    if (handle.includes('w')) left = right - width;
    else right = left + width;
  }

  return { x: left, y: top, width: Math.max(width, min), height: Math.max(height, min) };
}

/**
 * 端点手柄（line/arrow）：p1 拖拽改起点 x/y（终点不动），p2 改终点 x2/y2。
 * 端点可自由移动（两端可重合，与绘制单击落线的既有语义一致）。
 * 折线形态（ZOO-168）经 polylinePatch 同步改首/尾顶点，防止 x/y 与 points[0]
 * 双数据源漂移（lineVertices 优先读 points，漏改会出现端点拖不动的表象）。
 */
export function endpointResizePatch(
  handle: 'p1' | 'p2',
  startEl: LineElement | ArrowElement,
  world: { x: number; y: number }
): Partial<LineElement> {
  // 普通两点直线：仅改端点字段（既有最小补丁契约，调用方合并语义不变）
  if (!isPolyline(startEl)) {
    return handle === 'p1' ? { x: world.x, y: world.y } : { x2: world.x, y2: world.y };
  }
  const vertices = lineVertices(startEl).map((p) => ({ x: p.x, y: p.y }));
  if (handle === 'p1') vertices[0] = { x: world.x, y: world.y };
  else vertices[vertices.length - 1] = { x: world.x, y: world.y };
  return polylinePatch(startEl, vertices);
}

/**
 * path 包围盒角控点整体等比缩放：以对角为锚，点集按统一比例缩放（笔迹形状不变）。
 * 比例取主导轴（x/y 折算变化大者，与 textResizePatch 同构）；下限保证包围盒
 * 任一非零维度不小于 minSize（防拖成一点）。x/y 同步为缩放后首点（保持字段语义）。
 */
export function pathResizePatch(
  handle: CornerHandle,
  startEl: PathElement,
  world: { x: number; y: number },
  opts?: ResizeOpts
): Pick<PathElement, 'x' | 'y' | 'points'> {
  const min = opts?.minSize ?? SHAPE_MIN_SIZE;
  const b = elementLocalFrame(startEl);
  if (!b || startEl.points.length === 0) return { x: startEl.x, y: startEl.y, points: startEl.points };

  const anchorX = handle.includes('w') ? b.x + b.width : b.x;
  const anchorY = handle.includes('n') ? b.y + b.height : b.y;
  const spanX = b.width || 1;
  const spanY = b.height || 1;
  const sx = Math.max(0, handle.includes('w') ? (b.x + b.width - world.x) / spanX : (world.x - b.x) / spanX);
  const sy = Math.max(0, handle.includes('n') ? (b.y + b.height - world.y) / spanY : (world.y - b.y) / spanY);
  // 主导轴比例（与 textResizePatch 同构）；退化轴（跨度 0，如平坦笔迹）不参与折算，
  // 否则以名义跨度 1 折算出的巨大比例会把另一轴放大到失控
  const dominant =
    !(b.height > 0) ? sx :
    !(b.width > 0) ? sy :
    Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
  const minScale = Math.max(
    b.width > 0 ? min / b.width : 0,
    b.height > 0 ? min / b.height : 0
  );
  const s = Math.max(dominant, minScale);

  const points = startEl.points.map((p) => ({
    x: anchorX + (p.x - anchorX) * s,
    y: anchorY + (p.y - anchorY) * s,
  }));
  return { x: points[0].x, y: points[0].y, points };
}

/**
 * 缩放手势收尾判变（ZOO-160）：泛化 mathPlot/text 的字段比较到全类型。
 * path 的 points 每次直改都产新数组（引用必变），须逐点比值——零位移抖动不压空快照。
 */
export function elementResizeChanged(cur: WhiteboardElement, before: WhiteboardElement): boolean {
  const keys = new Set([...Object.keys(cur), ...Object.keys(before)]);
  for (const k of keys) {
    const va = (cur as unknown as Record<string, unknown>)[k];
    const vb = (before as unknown as Record<string, unknown>)[k];
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length) return true;
      if (va.some((p, i) => {
        const q = vb[i] as { x: number; y: number } | undefined;
        return !q || p.x !== q.x || p.y !== q.y;
      })) return true;
    } else if (va !== vb) {
      return true;
    }
  }
  return false;
}
