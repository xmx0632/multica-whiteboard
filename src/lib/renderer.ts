import { WhiteboardElement, PathElement, RectangleElement, CircleElement, LineElement, ArrowElement, TextElement, MathPlotElement, Viewport, Point } from './types';
import { drawMathPlot, resolvePlotRender } from './math/plot';
import { plotTokenFor } from './math/cache';
import { dashPatternFor } from './stroke';

/**
 * 描边线型（ZOO-165）：按元素 dash + 线宽设 ctx 虚线数组（世界 px 模式 × scale →
 * 屏幕 px）。solid 不触碰 setLineDash；save/restore 作用域内调用即可，无需手动复位。
 */
function applyDash(ctx: CanvasRenderingContext2D, el: WhiteboardElement, scale: number) {
  const pattern = dashPatternFor(el.dash, el.strokeWidth);
  if (pattern.length > 0) ctx.setLineDash(pattern.map((v) => v * scale));
}

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport
) {
  const gridSize = 20;
  const { offsetX, offsetY, scale } = viewport;

  ctx.save();
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, width, height);

  if (scale < 0.15) {
    ctx.restore();
    return;
  }

  const dotSize = Math.max(0.5, 1 * scale);
  ctx.fillStyle = '#d1d5db';

  const startX = offsetX % (gridSize * scale);
  const startY = offsetY % (gridSize * scale);

  for (let x = startX; x < width; x += gridSize * scale) {
    for (let y = startY; y < height; y += gridSize * scale) {
      ctx.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
    }
  }
  ctx.restore();
}

function drawPath(ctx: CanvasRenderingContext2D, el: PathElement, viewport: Viewport) {
  if (el.points.length < 2) return;
  const { offsetX, offsetY, scale } = viewport;

  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  applyDash(ctx, el, scale);

  ctx.beginPath();
  const p0 = el.points[0];
  ctx.moveTo(p0.x * scale + offsetX, p0.y * scale + offsetY);

  if (el.points.length === 2) {
    const p1 = el.points[1];
    ctx.lineTo(p1.x * scale + offsetX, p1.y * scale + offsetY);
  } else {
    for (let i = 1; i < el.points.length - 1; i++) {
      const p = el.points[i];
      const pn = el.points[i + 1];
      const mx = (p.x + pn.x) / 2;
      const my = (p.y + pn.y) / 2;
      ctx.quadraticCurveTo(
        p.x * scale + offsetX,
        p.y * scale + offsetY,
        mx * scale + offsetX,
        my * scale + offsetY
      );
    }
    const last = el.points[el.points.length - 1];
    ctx.lineTo(last.x * scale + offsetX, last.y * scale + offsetY);
  }

  ctx.stroke();
  ctx.restore();
}

function drawRectangle(ctx: CanvasRenderingContext2D, el: RectangleElement, viewport: Viewport) {
  const { offsetX, offsetY, scale } = viewport;
  const x = el.x * scale + offsetX;
  const y = el.y * scale + offsetY;
  const w = el.width * scale;
  const h = el.height * scale;

  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth * scale;
  ctx.lineJoin = 'round';
  applyDash(ctx, el, scale);

  if (el.fillColor) {
    ctx.fillStyle = el.fillColor;
    ctx.fillRect(x, y, w, h);
  }
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawCircle(ctx: CanvasRenderingContext2D, el: CircleElement, viewport: Viewport) {
  const { offsetX, offsetY, scale } = viewport;
  const cx = el.x * scale + offsetX + (el.width * scale) / 2;
  const cy = el.y * scale + offsetY + (el.height * scale) / 2;
  const rx = (el.width * scale) / 2;
  const ry = (el.height * scale) / 2;

  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth * scale;
  applyDash(ctx, el, scale);

  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
  if (el.fillColor) {
    ctx.fillStyle = el.fillColor;
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

function drawLine(ctx: CanvasRenderingContext2D, el: LineElement, viewport: Viewport) {
  const { offsetX, offsetY, scale } = viewport;

  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth * scale;
  ctx.lineCap = 'round';
  applyDash(ctx, el, scale);

  ctx.beginPath();
  ctx.moveTo(el.x * scale + offsetX, el.y * scale + offsetY);
  ctx.lineTo(el.x2 * scale + offsetX, el.y2 * scale + offsetY);
  ctx.stroke();
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, el: ArrowElement, viewport: Viewport) {
  const { offsetX, offsetY, scale } = viewport;
  const x1 = el.x * scale + offsetX;
  const y1 = el.y * scale + offsetY;
  const x2 = el.x2 * scale + offsetX;
  const y2 = el.y2 * scale + offsetY;

  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.strokeStyle = el.strokeColor;
  ctx.fillStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth * scale;
  ctx.lineCap = 'round';
  applyDash(ctx, el, scale);

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const headLen = Math.max(10, el.strokeWidth * 4) * scale;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, el: TextElement, viewport: Viewport) {
  const { offsetX, offsetY, scale } = viewport;
  const x = el.x * scale + offsetX;
  const y = el.y * scale + offsetY;
  const fontSize = el.fontSize * scale;

  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.fillStyle = el.color;
  ctx.font = `${fontSize}px ${el.fontFamily || 'sans-serif'}`;
  ctx.textBaseline = 'top';

  const lines = el.content.split('\n');
  const lineHeight = fontSize * 1.3;
  lines.forEach((line, i) => {
    ctx.fillText(line, x, y + i * lineHeight);
  });
  ctx.restore();
}

/**
 * MathPlot 元素绘制（技术方案 §5.2 三层坐标映射，与 drawRectangle 同构）：
 * translate(el.x·scale+offset) → scale → drawMathPlot。采样 / Path2D 经
 * resolvePlotRender 走按 id 的稳定键缓存（math/cache.ts plotTokenFor）——
 * 拖拽移动、改颜色线宽透明度、轴网显隐均命中缓存不重采样（§6.3）。
 */
function drawMathPlotElement(ctx: CanvasRenderingContext2D, el: MathPlotElement, viewport: Viewport) {
  if (!(el.width > 0) || !(el.height > 0)) return;
  const render = resolvePlotRender(
    {
      equation: el.equation,
      kind: el.kind,
      errorMessage: el.error ?? undefined,
      xAxis: el.xAxis,
      equalRatio: el.equalRatio,
      sampleCount: el.sampleCount,
    },
    { width: el.width, height: el.height },
    plotTokenFor(el.id)
  );
  const { offsetX, offsetY, scale } = viewport;
  ctx.save();
  ctx.translate(el.x * scale + offsetX, el.y * scale + offsetY);
  ctx.scale(scale, scale);
  drawMathPlot(ctx, {
    x: 0,
    y: 0,
    width: el.width,
    height: el.height,
    render,
    style: { strokeColor: el.strokeColor, strokeWidth: el.strokeWidth, opacity: el.opacity },
    showAxis: el.showAxis,
    showGrid: el.showGrid,
    showLabel: el.showLabel,
    equation: el.equation,
  });
  ctx.restore();
}

export function renderElement(ctx: CanvasRenderingContext2D, el: WhiteboardElement, viewport: Viewport) {
  switch (el.type) {
    case 'path': drawPath(ctx, el, viewport); break;
    case 'rectangle': drawRectangle(ctx, el, viewport); break;
    case 'circle': drawCircle(ctx, el, viewport); break;
    case 'line': drawLine(ctx, el, viewport); break;
    case 'arrow': drawArrow(ctx, el, viewport); break;
    case 'text': drawText(ctx, el, viewport); break;
    case 'mathPlot': drawMathPlotElement(ctx, el, viewport); break;
  }
}

/**
 * 视口 culling（技术方案 §6.4 性能预算配套，收益全元素类型）：
 * 元素世界包围盒与可视区（屏幕矩形经 viewport 反变换）无交集则跳过绘制。
 * 包围盒不可得（空 path / 未知类型）时不剔除，保守绘制。
 */
export function elementIntersectsView(
  el: WhiteboardElement,
  viewport: Viewport,
  viewWidth: number,
  viewHeight: number
): boolean {
  const bbox = getElementBounds(el);
  if (!bbox) return true;
  const { offsetX, offsetY, scale } = viewport;
  const sx = bbox.x * scale + offsetX;
  const sy = bbox.y * scale + offsetY;
  const sw = bbox.width * scale;
  const sh = bbox.height * scale;
  return sx + sw >= 0 && sx <= viewWidth && sy + sh >= 0 && sy <= viewHeight;
}

export function renderElements(
  ctx: CanvasRenderingContext2D,
  elements: WhiteboardElement[],
  viewport: Viewport,
  viewSize?: { width: number; height: number }
) {
  for (const el of elements) {
    if (viewSize && !elementIntersectsView(el, viewport, viewSize.width, viewSize.height)) continue;
    renderElement(ctx, el, viewport);
  }
}

/** mathPlot 控点方位标识（拖拽缩放语义见 Canvas.tsx resizeState）。 */
export type MathPlotHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** line/arrow 端点手柄标识（ZOO-160：p1 起点改 x/y，p2 终点改 x2/y2） */
export type EndpointHandle = 'p1' | 'p2';

/** 全元素控点标识（ZOO-160：mathPlot 8 方位 + line/arrow 端点 + 其余 4 角） */
export type ResizeHandleId = MathPlotHandle | EndpointHandle;

/** 控点方块边长（屏幕 px，样式基线与 mathPlot 8 控点一致） */
const HANDLE_SIZE = 8;

/**
 * 选中框控点布局（§11 D-1 + ZOO-160）：mathPlot 8 控点（4 角 + 4 边中点，已验收基线）、
 * line/arrow 两端点手柄、其余（rect/circle/path/text）4 角控点。
 * 返回 id + 8×8 屏幕矩形（画布 rect 相对 px；方块中心即角点 / 端点）。
 */
function selectionHandleLayout(el: WhiteboardElement, viewport: Viewport): { id: ResizeHandleId; rect: [number, number] }[] {
  const { offsetX, offsetY, scale } = viewport;
  const s = HANDLE_SIZE;

  if (el.type === 'line' || el.type === 'arrow') {
    return [
      { id: 'p1', rect: [el.x * scale + offsetX - s / 2, el.y * scale + offsetY - s / 2] },
      { id: 'p2', rect: [el.x2 * scale + offsetX - s / 2, el.y2 * scale + offsetY - s / 2] },
    ];
  }

  const bbox = getElementBounds(el);
  if (!bbox) return [];
  const x = bbox.x * scale + offsetX;
  const y = bbox.y * scale + offsetY;
  const r = x + bbox.width * scale + 4;
  const b = y + bbox.height * scale + 4;
  if (el.type === 'mathPlot') {
    return [
      { id: 'nw', rect: [x - 4, y - 4] }, { id: 'ne', rect: [r - s, y - 4] },
      { id: 'sw', rect: [x - 4, b - s] }, { id: 'se', rect: [r - s, b - s] },
      { id: 'n', rect: [(x - 4 + r) / 2 - s / 2, y - 4] },
      { id: 's', rect: [(x - 4 + r) / 2 - s / 2, b - s] },
      { id: 'w', rect: [x - 4, (y - 4 + b) / 2 - s / 2] },
      { id: 'e', rect: [r - s, (y - 4 + b) / 2 - s / 2] },
    ];
  }
  return [
    { id: 'nw', rect: [x - 4, y - 4] },
    { id: 'ne', rect: [r - s, y - 4] },
    { id: 'sw', rect: [x - 4, b - s] },
    { id: 'se', rect: [r - s, b - s] },
  ];
}

export function renderSelection(
  ctx: CanvasRenderingContext2D,
  el: WhiteboardElement,
  viewport: Viewport
) {
  const { offsetX, offsetY, scale } = viewport;
  const bbox = getElementBounds(el);
  if (!bbox) return;

  const x = bbox.x * scale + offsetX;
  const y = bbox.y * scale + offsetY;
  const w = bbox.width * scale;
  const h = bbox.height * scale;

  ctx.save();
  ctx.strokeStyle = '#3B82F6';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
  ctx.setLineDash([]);

  ctx.fillStyle = '#3B82F6';
  for (const { rect: [hx, hy] } of selectionHandleLayout(el, viewport)) {
    ctx.fillRect(hx, hy, HANDLE_SIZE, HANDLE_SIZE);
  }
  ctx.restore();
}

/**
 * 选中框控点命中（屏幕 px，画布 rect 相对坐标）。全部元素类型均有可拖控点
 * （ZOO-160）：mathPlot 8 方位、line/arrow 端点、rect/circle/path/text 4 角。
 * opts.margin 判定外扩（默认 2 鼠标 / 触控笔；触摸传 18 → 44px 等效命中框）。
 */
export function hitTestSelectionHandle(
  el: WhiteboardElement,
  screen: Point,
  viewport: Viewport,
  opts?: { margin?: number }
): ResizeHandleId | null {
  const layout = selectionHandleLayout(el, viewport);
  const m = opts?.margin ?? 2; // 判定外扩，降低精确点选难度
  for (const { id, rect: [hx, hy] } of layout) {
    if (screen.x >= hx - m && screen.x <= hx + HANDLE_SIZE + m && screen.y >= hy - m && screen.y <= hy + HANDLE_SIZE + m) {
      return id;
    }
  }
  return null;
}

/**
 * 元素整体平移（ZOO-154）：x/y 与所有锚点同步位移，几何形状不变。
 * 多锚点类型——line/arrow 的 x2/y2、path 的 points——均随基准点平移；
 * rectangle/circle/text/mathPlot 等外框语义类型只需 x/y。纯函数，不改原元素。
 */
export function translateElement(el: WhiteboardElement, dx: number, dy: number): WhiteboardElement {
  const moved = { ...el, x: el.x + dx, y: el.y + dy } as WhiteboardElement;
  switch (moved.type) {
    case 'line':
    case 'arrow':
      return { ...moved, x2: moved.x2 + dx, y2: moved.y2 + dy };
    case 'path':
      return { ...moved, points: moved.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    default:
      return moved;
  }
}

export function getElementBounds(el: WhiteboardElement): { x: number; y: number; width: number; height: number } | null {
  switch (el.type) {
    case 'path': {
      if (el.points.length === 0) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of el.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case 'rectangle':
    case 'circle':
    case 'mathPlot':
      return { x: el.x, y: el.y, width: el.width, height: el.height };
    case 'line':
    case 'arrow': {
      const minX = Math.min(el.x, el.x2);
      const minY = Math.min(el.y, el.y2);
      return { x: minX, y: minY, width: Math.abs(el.x2 - el.x), height: Math.abs(el.y2 - el.y) };
    }
    case 'text':
      return { x: el.x, y: el.y, width: el.width || 100, height: el.height || el.fontSize * 1.3 };
    default:
      return null;
  }
}

export function hitTest(el: WhiteboardElement, point: Point, viewport: Viewport): boolean {
  const { scale } = viewport;
  const bbox = getElementBounds(el);
  if (!bbox) return false;

  const margin = Math.max(8 / scale, el.strokeWidth / 2 + 4 / scale);
  return (
    point.x >= bbox.x - margin &&
    point.x <= bbox.x + bbox.width + margin &&
    point.y >= bbox.y - margin &&
    point.y <= bbox.y + bbox.height + margin
  );
}

export function screenToCanvas(screen: Point, viewport: Viewport): Point {
  return {
    x: (screen.x - viewport.offsetX) / viewport.scale,
    y: (screen.y - viewport.offsetY) / viewport.scale,
  };
}

export function getAllElementsBounds(elements: WhiteboardElement[]): { x: number; y: number; width: number; height: number } | null {
  if (elements.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const bbox = getElementBounds(el);
    if (!bbox) continue;
    minX = Math.min(minX, bbox.x);
    minY = Math.min(minY, bbox.y);
    maxX = Math.max(maxX, bbox.x + bbox.width);
    maxY = Math.max(maxY, bbox.y + bbox.height);
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
