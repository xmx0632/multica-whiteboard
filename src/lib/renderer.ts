import { WhiteboardElement, PathElement, RectangleElement, CircleElement, DiamondElement, LineElement, ArrowElement, TextElement, MathPlotElement, FrameElement, Viewport, Point } from './types';
import { drawMathPlot, resolvePlotRender, type PlotSpec } from './math/plot';
import { resolveDragPoints } from './math/dragPoint';
import type { LibT } from '../i18n/lib';
import { plotTokenFor } from './math/cache';
import { dashPatternFor } from './stroke';
import { lineVertices, vertexHandle, VertexHandle, isPolyline, nearestOnPolyline } from './polyline';
import { FRAME_TITLE_HEIGHT } from './frame';
import { elementRotation, rotatePointAround, pointerToLocalFrame } from './rotation';

/**
 * MathPlotElement → PlotSpec（ZOO-199 提取共享）：drawMathPlotElement 与
 * export / POI 交互层（lib/poi.ts）组装同一份数学输入——保证主画布渲染、
 * SVG 导出、悬停 / 点击命中共用一份 resolvePlotRender 缓存。
 */
export function mathPlotSpecOf(el: MathPlotElement): PlotSpec {
  return {
    equation: el.equation,
    kind: el.kind,
    errorMessage: el.error ?? undefined,
    xAxis: el.xAxis,
    equalRatio: el.equalRatio,
    sampleCount: el.sampleCount,
    constants: el.constants,
    overlays: el.overlays,
  };
}

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

/**
 * 矩形绘制（ZOO-221 起支持旋转）：rotation ≠ 0 时 translate 到几何中心 →
 * rotate(顺时针 rad) → 以 (-w/2,-h/2) 为左上角 fill/stroke；rotation = 0 /
 * 缺省保持旧直绘路径——旧文档逐像素等价（坐标运算序都不变）。
 */
function drawRectangle(ctx: CanvasRenderingContext2D, el: RectangleElement, viewport: Viewport) {
  const { offsetX, offsetY, scale } = viewport;
  const w = el.width * scale;
  const h = el.height * scale;
  const rot = elementRotation(el);

  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth * scale;
  ctx.lineJoin = 'round';
  applyDash(ctx, el, scale);

  if (rot === 0) {
    const x = el.x * scale + offsetX;
    const y = el.y * scale + offsetY;
    if (el.fillColor) {
      ctx.fillStyle = el.fillColor;
      ctx.fillRect(x, y, w, h);
    }
    ctx.strokeRect(x, y, w, h);
  } else {
    ctx.translate((el.x + el.width / 2) * scale + offsetX, (el.y + el.height / 2) * scale + offsetY);
    ctx.rotate((rot * Math.PI) / 180);
    if (el.fillColor) {
      ctx.fillStyle = el.fillColor;
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    ctx.strokeRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

/**
 * 椭圆绘制（ZOO-223 起支持旋转）：ellipse 自带 rotation 形参（绕中心弧度），
 * 与 drawRectangle 的 translate→rotate 同一口径；rotation = 0 / 缺省传 0，
 * 旧路径逐字节等价。
 */
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
  ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), (elementRotation(el) * Math.PI) / 180, 0, Math.PI * 2);
  if (el.fillColor) {
    ctx.fillStyle = el.fillColor;
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 菱形四顶点（ZOO-217）：外框四边中点按上→右→下→左序推导，不落顶点字段——
 * 绘制 / 命中 / SVG 导出共一份推导（负 width/height 拖拽翻转下仍构成菱形）。
 */
export function diamondVertices(el: DiamondElement): [Point, Point, Point, Point] {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return [
    { x: cx, y: el.y },
    { x: el.x + el.width, y: cy },
    { x: cx, y: el.y + el.height },
    { x: el.x, y: cy },
  ];
}

/**
 * 菱形绘制（ZOO-217，与 drawRectangle 同构）：四中点 moveTo/lineTo×4 + closePath。
 * ZOO-223 起支持旋转：rotation ≠ 0 时 translate 到几何中心 → rotate → 顶点按
 * 局部偏移绘制（diamondVertices 恒为局部系推导，世界系占用走 AABB）；rot = 0 /
 * 缺省保持旧直绘路径——旧文档逐像素等价。
 */
function drawDiamond(ctx: CanvasRenderingContext2D, el: DiamondElement, viewport: Viewport) {
  const { offsetX, offsetY, scale } = viewport;

  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth * scale;
  ctx.lineJoin = 'round';
  applyDash(ctx, el, scale);

  const rot = elementRotation(el);
  const verts = diamondVertices(el);
  ctx.beginPath();
  if (rot === 0) {
    ctx.moveTo(verts[0].x * scale + offsetX, verts[0].y * scale + offsetY);
    for (let i = 1; i < 4; i++) {
      ctx.lineTo(verts[i].x * scale + offsetX, verts[i].y * scale + offsetY);
    }
  } else {
    const cx = (el.x + el.width / 2) * scale + offsetX;
    const cy = (el.y + el.height / 2) * scale + offsetY;
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.moveTo((verts[0].x - (el.x + el.width / 2)) * scale, (verts[0].y - (el.y + el.height / 2)) * scale);
    for (let i = 1; i < 4; i++) {
      ctx.lineTo((verts[i].x - (el.x + el.width / 2)) * scale, (verts[i].y - (el.y + el.height / 2)) * scale);
    }
  }
  ctx.closePath();
  if (el.fillColor) {
    ctx.fillStyle = el.fillColor;
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 点是否在凸多边形内（ZOO-217 菱形命中用）：逐边叉积同号判定——边界（叉积 0）
 * 视为内部，顺 / 逆时针顶点序均成立。非凸输入会误判，本函数只服务菱形四顶点。
 */
function pointInConvexPolygon(p: Point, verts: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** line/arrow 折线形态绘制（ZOO-168）：逐段 lineTo；普通两点直线与旧渲染逐像素等价 */
function drawLinearPath(
  ctx: CanvasRenderingContext2D,
  el: LineElement | ArrowElement,
  viewport: Viewport
): { headX: number; headY: number; headAngle: number } | null {
  const { offsetX, offsetY, scale } = viewport;
  const pts = lineVertices(el);
  if (pts.length < 2) return null;
  ctx.beginPath();
  ctx.moveTo(pts[0].x * scale + offsetX, pts[0].y * scale + offsetY);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x * scale + offsetX, pts[i].y * scale + offsetY);
  }
  ctx.stroke();
  // 箭头语义：折线化后箭头跟随最后一段的方向（ZOO-168 验收 5）
  const n = pts.length;
  const x2 = pts[n - 1].x * scale + offsetX;
  const y2 = pts[n - 1].y * scale + offsetY;
  const prev = pts[n - 2];
  return { headX: x2, headY: y2, headAngle: Math.atan2(pts[n - 1].y - prev.y, pts[n - 1].x - prev.x) };
}

function drawLine(ctx: CanvasRenderingContext2D, el: LineElement, viewport: Viewport) {
  const { scale } = viewport;
  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  applyDash(ctx, el, scale);
  drawLinearPath(ctx, el, viewport);
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, el: ArrowElement, viewport: Viewport) {
  const { scale } = viewport;

  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.strokeStyle = el.strokeColor;
  ctx.fillStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  applyDash(ctx, el, scale);

  const head = drawLinearPath(ctx, el, viewport);
  if (!head) {
    ctx.restore();
    return;
  }

  const headLen = Math.max(10, el.strokeWidth * 4) * scale;
  const { headX: x2, headY: y2, headAngle: angle } = head;
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
function drawMathPlotElement(ctx: CanvasRenderingContext2D, el: MathPlotElement, viewport: Viewport, t?: LibT) {
  if (!(el.width > 0) || !(el.height > 0)) return;
  const render = resolvePlotRender(mathPlotSpecOf(el), { width: el.width, height: el.height }, plotTokenFor(el.id));
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
    // ZOO-176：错误占位提示文案随语言（缺省中文）
    t,
    // ZOO-199：持久化 POI 标注仅显式函数绘制（其余 kind 数据保留、不绘制）
    ...(el.kind === 'explicit' && !el.error && el.poiAnnotations && el.poiAnnotations.length > 0
      ? { poiAnnotations: el.poiAnnotations }
      : {}),
    // ZOO-201：可拖点仅显式函数绘制（坐标由常量派生，随常量直改实时重绘）
    ...(el.kind === 'explicit' && !el.error && el.draggablePoints && el.draggablePoints.length > 0
      ? { dragPoints: resolveDragPoints(el) }
      : {}),
  });
  ctx.restore();
}

/**
 * 分页帧底图（ZOO-198）：白色页底 + 页框 + 帧上缘外侧页名。帧绘制在内容层之下
 * （Canvas 渲染前分区、export 帧先画），不遮挡内容。页框线宽 / 页名字号为屏幕
 * 恒定 px（任意缩放下视觉稳定，export scale=1 时同值）。active = 当前页蓝框高亮。
 * opts.showTitle=false 供小尺寸缩略图省略页名。
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  el: FrameElement,
  viewport: Viewport,
  opts?: { active?: boolean; showTitle?: boolean }
) {
  const { offsetX, offsetY, scale } = viewport;
  const x = el.x * scale + offsetX;
  const y = el.y * scale + offsetY;
  const w = el.width * scale;
  const h = el.height * scale;
  const active = opts?.active ?? false;

  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = active ? '#3B82F6' : '#cbd5e1';
  ctx.lineWidth = active ? 2 : 1.5;
  ctx.strokeRect(x, y, w, h);
  if (opts?.showTitle !== false) {
    ctx.fillStyle = active ? '#3B82F6' : '#64748b';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(el.name, x, y - 10);
  }
  ctx.restore();
}

export function renderElement(
  ctx: CanvasRenderingContext2D,
  el: WhiteboardElement,
  viewport: Viewport,
  t?: LibT,
) {
  switch (el.type) {
    case 'path': drawPath(ctx, el, viewport); break;
    case 'rectangle': drawRectangle(ctx, el, viewport); break;
    case 'circle': drawCircle(ctx, el, viewport); break;
    case 'diamond': drawDiamond(ctx, el, viewport); break;
    case 'line': drawLine(ctx, el, viewport); break;
    case 'arrow': drawArrow(ctx, el, viewport); break;
    case 'text': drawText(ctx, el, viewport); break;
    case 'mathPlot': drawMathPlotElement(ctx, el, viewport, t); break;
    case 'frame': drawFrame(ctx, el, viewport); break;
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
  const bbox = elementBoundsAABB(el);
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
  viewSize?: { width: number; height: number; t?: LibT }
) {
  for (const el of elements) {
    if (viewSize && !elementIntersectsView(el, viewport, viewSize.width, viewSize.height)) continue;
    renderElement(ctx, el, viewport, viewSize?.t);
  }
}

/** mathPlot 控点方位标识（拖拽缩放语义见 Canvas.tsx resizeState）。 */
export type MathPlotHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** line/arrow 端点手柄标识（ZOO-160：p1 起点改 x/y，p2 终点改 x2/y2） */
export type EndpointHandle = 'p1' | 'p2';

/** 全元素控点标识（ZOO-160：mathPlot 8 方位 + line/arrow 端点 + 其余 4 角；ZOO-168 增折线顶点 vN） */
export type ResizeHandleId = MathPlotHandle | EndpointHandle | VertexHandle;

/** 控点方块边长（屏幕 px，样式基线与 mathPlot 8 控点一致） */
const HANDLE_SIZE = 8;

// —— 旋转手柄（ZOO-222，Excalidraw/Miro 惯例）：选中框上缘中点向外悬伸 ——
/** 手柄圆心到选中框上缘的悬伸距离（屏幕 px 常量，不随视口缩放） */
const ROTATE_HANDLE_STEM = 20;
/** 手柄圆半径（屏幕 px） */
export const ROTATE_HANDLE_RADIUS = 6;
/** 触摸命中半径（ZOO-160 的 44px 等效口径：直径 44） */
const ROTATE_TOUCH_HIT_RADIUS = 22;
/** 鼠标 / 触控笔命中半径（手柄半径 + 4px 判定外扩） */
const ROTATE_MOUSE_HIT_RADIUS = ROTATE_HANDLE_RADIUS + 4;

/** 可旋转元素判定（ZOO-223 起三形状：rectangle / ellipse(circle) / diamond） */
export function isRotatable(el: WhiteboardElement): el is RectangleElement | CircleElement | DiamondElement {
  return el.type === 'rectangle' || el.type === 'circle' || el.type === 'diamond';
}

/**
 * 旋转手柄几何（局部系屏幕 px，ZOO-222）：stem 从选中框上缘中点（含 4px 外扩）
 * 向外悬伸，圆心再外移 STEM——绘制在旋转 ctx 内直接用局部坐标；rot ≠ 0 时
 * 命中侧须把指针逆旋转后比对（hitTestRotationHandle）。三形状均有手柄
 * （ZOO-223 起 rect/ellipse/diamond）。
 */
function rotationHandleGeometry(
  el: WhiteboardElement,
  viewport: Viewport
): { stemFrom: Point; center: Point } | null {
  if (!isRotatable(el)) return null;
  const frame = elementLocalFrame(el);
  if (!frame) return null;
  const { offsetX, offsetY, scale } = viewport;
  const stemFrom: Point = {
    x: (frame.x + frame.width / 2) * scale + offsetX,
    y: frame.y * scale + offsetY - 4,
  };
  return {
    stemFrom,
    center: { x: stemFrom.x, y: stemFrom.y - ROTATE_HANDLE_STEM - ROTATE_HANDLE_RADIUS },
  };
}

/**
 * 旋转手柄命中（屏幕 px，画布 rect 相对坐标，ZOO-222）：指针逆旋转进局部系后
 * 按圆形判定——鼠标 / 触控笔半径 10，触摸 22（44px 等效口径，沿 ZOO-160）。
 * 三形状有旋转手柄（ZOO-223），其余类型恒 false。
 */
export function hitTestRotationHandle(
  el: WhiteboardElement,
  screen: Point,
  viewport: Viewport,
  opts?: { touch?: boolean }
): boolean {
  if (!isRotatable(el)) return false;
  const geo = rotationHandleGeometry(el, viewport);
  if (!geo) return false;
  const probe = pointerToLocalFrame(screen, rotateFrameOf(el, viewport), elementRotation(el));
  const r = opts?.touch ? ROTATE_TOUCH_HIT_RADIUS : ROTATE_MOUSE_HIT_RADIUS;
  return Math.hypot(probe.x - geo.center.x, probe.y - geo.center.y) <= r;
}

/** 旋转命中用的「屏幕系局部框」（与 selectionHandleLayout 同一坐标口径） */
function rotateFrameOf(el: WhiteboardElement, viewport: Viewport): { x: number; y: number; width: number; height: number } {
  const frame = elementLocalFrame(el);
  if (!frame) return { x: 0, y: 0, width: 0, height: 0 };
  const { offsetX, offsetY, scale } = viewport;
  return {
    x: frame.x * scale + offsetX,
    y: frame.y * scale + offsetY,
    width: frame.width * scale,
    height: frame.height * scale,
  };
}

/**
 * 选中框控点布局（§11 D-1 + ZOO-160）：mathPlot 8 控点（4 角 + 4 边中点，已验收基线）、
 * line/arrow 两端点手柄、其余（rect/circle/path/text）4 角控点。
 * ZOO-168 折线编辑态（polylineEditing）：line/arrow 布局换成逐顶点手柄 v0…vn-1
 * （v0 / v末位 语义同 p1 / p2）。
 * 返回 id + 8×8 屏幕矩形（画布 rect 相对 px；方块中心即角点 / 端点 / 顶点）。
 * ZOO-222 旋转系：可旋转形状返回**局部系**矩形（elementLocalFrame 的屏幕投影，
 * 不随旋转转动）——renderSelection 在旋转 ctx 内绘制、hitTestSelectionHandle 把
 * 指针逆旋转后比对，两侧同一坐标口径（ZOO-223 起三形状）。
 */
function selectionHandleLayout(
  el: WhiteboardElement,
  viewport: Viewport,
  polylineEditing = false
): { id: ResizeHandleId; rect: [number, number] }[] {
  const { offsetX, offsetY, scale } = viewport;
  const s = HANDLE_SIZE;

  if (el.type === 'line' || el.type === 'arrow') {
    if (polylineEditing) {
      return lineVertices(el).map((p, i) => ({
        id: vertexHandle(i),
        rect: [p.x * scale + offsetX - s / 2, p.y * scale + offsetY - s / 2] as [number, number],
      }));
    }
    return [
      { id: 'p1', rect: [el.x * scale + offsetX - s / 2, el.y * scale + offsetY - s / 2] },
      { id: 'p2', rect: [el.x2 * scale + offsetX - s / 2, el.y2 * scale + offsetY - s / 2] },
    ];
  }

  const bbox = elementLocalFrame(el);
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

/**
 * 选中态绘制。opts.polylineEditing（ZOO-168 折线编辑态）：line/arrow 不画包围盒
 * 虚线框（折线包围盒视觉噪音大），改画逐顶点圆点手柄——白底蓝圈，选中顶点
 * （opts.selectedVertex）实心蓝。
 * ZOO-222 旋转系：旋转矩形 save→translate(center)→rotate→局部框 / 控点→restore
 * ——选中框随元素旋转（控点画在局部四角）；rot = 0 不进变换（逐像素等价）。
 * 旋转手柄（rect）：选中框上缘中点向外悬伸的 stem + 圆形手柄，绘制在旋转 ctx 内。
 */
export function renderSelection(
  ctx: CanvasRenderingContext2D,
  el: WhiteboardElement,
  viewport: Viewport,
  opts?: { polylineEditing?: boolean; selectedVertex?: number | null }
) {
  const { offsetX, offsetY, scale } = viewport;

  if (opts?.polylineEditing && (el.type === 'line' || el.type === 'arrow')) {
    ctx.save();
    for (const [i, p] of lineVertices(el).entries()) {
      const cx = p.x * scale + offsetX;
      const cy = p.y * scale + offsetY;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = i === opts.selectedVertex ? '#3B82F6' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  const bbox = elementLocalFrame(el);
  if (!bbox) return;

  const x = bbox.x * scale + offsetX;
  const y = bbox.y * scale + offsetY;
  const w = bbox.width * scale;
  const h = bbox.height * scale;

  ctx.save();
  // 旋转系选中框：绕几何中心转 rot 后局部框 / 控点坐标原样可用（布局即局部系）
  const rot = isRotatable(el) ? elementRotation(el) : 0;
  if (rot !== 0) {
    const cx = (bbox.x + bbox.width / 2) * scale + offsetX;
    const cy = (bbox.y + bbox.height / 2) * scale + offsetY;
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  ctx.strokeStyle = '#3B82F6';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
  ctx.setLineDash([]);

  ctx.fillStyle = '#3B82F6';
  for (const { rect: [hx, hy] } of selectionHandleLayout(el, viewport, opts?.polylineEditing ?? false)) {
    ctx.fillRect(hx, hy, HANDLE_SIZE, HANDLE_SIZE);
  }

  // 旋转手柄（ZOO-222）：stem 细线 + 白底蓝圈圆手柄（局部系坐标，随 ctx 旋转）
  const rotateGeo = rotationHandleGeometry(el, viewport);
  if (rotateGeo) {
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(rotateGeo.stemFrom.x, rotateGeo.stemFrom.y);
    ctx.lineTo(rotateGeo.center.x, rotateGeo.center.y + ROTATE_HANDLE_RADIUS);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rotateGeo.center.x, rotateGeo.center.y, ROTATE_HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 选中框控点命中（屏幕 px，画布 rect 相对坐标）。全部元素类型均有可拖控点
 * （ZOO-160）：mathPlot 8 方位、line/arrow 端点、rect/circle/path/text 4 角。
 * opts.polylineEditing（ZOO-168）：line/arrow 改按逐顶点手柄布局判定。
 * opts.margin 判定外扩（默认 2 鼠标 / 触控笔；触摸传 18 → 44px 等效命中框）。
 * ZOO-222 旋转系：旋转矩形先把指针逆旋转进局部系再查局部矩形——屏幕上转到
 * 哪里、命中的仍是旋转前那个角。
 */
export function hitTestSelectionHandle(
  el: WhiteboardElement,
  screen: Point,
  viewport: Viewport,
  opts?: { margin?: number; polylineEditing?: boolean }
): ResizeHandleId | null {
  const layout = selectionHandleLayout(el, viewport, opts?.polylineEditing ?? false);
  const probe = isRotatable(el)
    ? pointerToLocalFrame(screen, rotateFrameOf(el, viewport), elementRotation(el))
    : screen;
  const m = opts?.margin ?? 2; // 判定外扩，降低精确点选难度
  for (const { id, rect: [hx, hy] } of layout) {
    if (probe.x >= hx - m && probe.x <= hx + HANDLE_SIZE + m && probe.y >= hy - m && probe.y <= hy + HANDLE_SIZE + m) {
      return id;
    }
  }
  return null;
}

/**
 * 元素整体平移（ZOO-154）：x/y 与所有锚点同步位移，几何形状不变。
 * 多锚点类型——line/arrow 的 x2/y2（折线形态含 points 全顶点，ZOO-168）、
 * path 的 points——均随基准点平移；rectangle/circle/text/mathPlot 等外框语义
 * 类型只需 x/y。纯函数，不改原元素。
 */
export function translateElement(el: WhiteboardElement, dx: number, dy: number): WhiteboardElement {
  const moved = { ...el, x: el.x + dx, y: el.y + dy } as WhiteboardElement;
  switch (moved.type) {
    case 'line':
    case 'arrow': {
      const shifted = { ...moved, x2: moved.x2 + dx, y2: moved.y2 + dy } as LineElement | ArrowElement;
      return isPolyline(shifted)
        ? { ...shifted, points: (shifted.points as Point[]).map((p) => ({ x: p.x + dx, y: p.y + dy })) }
        : shifted;
    }
    case 'path':
      return { ...moved, points: moved.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    default:
      return moved;
  }
}

/**
 * 局部外框（ZOO-221 命名分叉）：未旋转局部坐标系的 x/y/width/height 外框——
 * 供选中框 / 控点布局 / 缩放锚定。旋转元素的矩形旋转不改外框字段，故此处
 * 恒返回存储外框；要「元素在世界系占多大」必须走 elementBoundsAABB。
 * 两套语义成对命名、不可互换（矩形旋转系列最大隐性风险：culling 拿局部框
 * 会裁掉旋出部分、选中框拿 AABB 会框进四角空白）。
 */
export function elementLocalFrame(el: WhiteboardElement): { x: number; y: number; width: number; height: number } | null {
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
    case 'diamond':
    case 'mathPlot':
      return { x: el.x, y: el.y, width: el.width, height: el.height };
    case 'frame':
      // 含上缘标题条：选中框 / culling / 全板导出边界都覆盖页名（ZOO-198）
      return { x: el.x, y: el.y - FRAME_TITLE_HEIGHT, width: el.width, height: el.height + FRAME_TITLE_HEIGHT };
    case 'line':
    case 'arrow': {
      // 折线形态：包围盒覆盖全部顶点（ZOO-168）；两点直线与旧算法等价
      const pts = lineVertices(el);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case 'text':
      return { x: el.x, y: el.y, width: el.width || 100, height: el.height || el.fontSize * 1.3 };
    default:
      return null;
  }
}

/**
 * 世界系 AABB（ZOO-221 命名分叉）：可旋转形状（rect/ellipse/diamond，ZOO-223
 * 起三形状）= 四角绕几何中心旋转后的轴对齐包围盒（只增不裁）；其余类型与
 * elementLocalFrame 同体。供 culling（elementIntersectsView）/ zoom-fit
 * （getAllElementsBounds）/ 导出边界 / 帧归属——旋出局部外框的部分不被视口
 * 剔除、不被导出裁剪。
 */
export function elementBoundsAABB(el: WhiteboardElement): { x: number; y: number; width: number; height: number } | null {
  const local = elementLocalFrame(el);
  if (!local) return null;
  if (isRotatable(el)) {
    const rot = elementRotation(el);
    if (rot !== 0) {
      const center = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
      const rad = (rot * Math.PI) / 180;
      const corners = [
        { x: el.x, y: el.y },
        { x: el.x + el.width, y: el.y },
        { x: el.x + el.width, y: el.y + el.height },
        { x: el.x, y: el.y + el.height },
      ].map((p) => rotatePointAround(p, center, rad));
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of corners) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
  }
  return local;
}

/**
 * 元素命中测试。line/arrow（含折线形态，ZOO-168）与 diamond（ZOO-217，填充态含
 * 内点判定）按精确轮廓判定——包围盒内部的空白区不再误命中；其余类型维持包围盒判定。
 * 可旋转形状（ZOO-221 矩形 → ZOO-223 三形状）先逆旋转指针回局部系再判——
 * 旋出局部外框的角可命中、AABB 四角的旋外空白不误命中（菱形精确轮廓同样
 * 在局部系判定，顶点推导不随旋转改写）。
 */
export function hitTest(el: WhiteboardElement, point: Point, viewport: Viewport): boolean {
  const { scale } = viewport;
  const bbox = elementLocalFrame(el);
  if (!bbox) return false;

  const margin = Math.max(8 / scale, el.strokeWidth / 2 + 4 / scale);

  if (el.type === 'line' || el.type === 'arrow') {
    const near = nearestOnPolyline(point, lineVertices(el));
    return near !== null && near.dist <= margin;
  }

  // 旋转形状（ZOO-221/223）：指针绕几何中心逆旋转回局部系再判（与选中框控点 /
  // 缩放适配共用 rotation.ts 的 pointerToLocalFrame 一份口径）
  const probe = isRotatable(el)
    ? pointerToLocalFrame(point, bbox, elementRotation(el))
    : point;

  // 菱形（ZOO-217）：精确轮廓命中——bbox 四角空白不误选。填充态 = 叉积同号
  // 内点判定 ∨ 四边距离带（边带容差与 line/arrow 同口径）；无填充态仅四边距离带。
  if (el.type === 'diamond') {
    const verts = diamondVertices(el);
    const closed = [...verts, verts[0]]; // 闭合回环：含左→右上一边
    const near = nearestOnPolyline(probe, closed);
    if (near !== null && near.dist <= margin) return true;
    return Boolean(el.fillColor) && pointInConvexPolygon(probe, verts);
  }

  // 帧（ZOO-198）：内部大片空白是板书区，不能挡内容命中——仅边框带 + 上缘标题条可选中
  if (el.type === 'frame') {
    const band = Math.max(8 / scale, el.strokeWidth / 2 + 4 / scale);
    const inTitle =
      point.x >= el.x && point.x <= el.x + el.width &&
      point.y >= el.y - FRAME_TITLE_HEIGHT && point.y < el.y;
    const innerX = point.x > el.x + band && point.x < el.x + el.width - band;
    const innerY = point.y > el.y + band && point.y < el.y + el.height - band;
    const inOuter =
      point.x >= el.x - band && point.x <= el.x + el.width + band &&
      point.y >= el.y - band && point.y <= el.y + el.height + band;
    return inTitle || (inOuter && !(innerX && innerY));
  }

  // 旋转形状（ZOO-221/223）：逆旋转后的局部系指针走既有 AABB + margin 判定
  return (
    probe.x >= bbox.x - margin &&
    probe.x <= bbox.x + bbox.width + margin &&
    probe.y >= bbox.y - margin &&
    probe.y <= bbox.y + bbox.height + margin
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
    const bbox = elementBoundsAABB(el);
    if (!bbox) continue;
    minX = Math.min(minX, bbox.x);
    minY = Math.min(minY, bbox.y);
    maxX = Math.max(maxX, bbox.x + bbox.width);
    maxY = Math.max(maxY, bbox.y + bbox.height);
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
