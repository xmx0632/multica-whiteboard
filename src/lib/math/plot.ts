/**
 * MathPlot 渲染核心（技术方案 §5.2 坐标映射 / §6.1 分层绘制 / §6.3 缓存，决策 D3）。
 *
 * 职责：把 sample.ts 产出的数学坐标折线绘制为矢量图形。全部绘制发生在
 * 「元素局部 px」空间（左上原点、y 向下），调用方负责外层变换：
 * - 主画布（4d 集成）：ctx.translate(el.x·scale+offsetX, …) → ctx.scale(scale)
 *   → drawMathPlot —— 与 drawRectangle 同构（§5.2 三层坐标映射）；
 * - MiniPreview：无外层变换，直接以 W×H 调 drawGraphCore（预览即真实渲染）。
 *
 * 性能契约（§6.4）：折线采样与 Path2D 构建经 resolvePlotRender 走 WeakMap
 * 缓存，签名只含数学输入（方程/视窗/采样档/尺寸）—— 视口平移缩放、改颜色
 * 线宽透明度、轴网显隐均不触发重采样，只对缓存 Path2D 重新 stroke。
 *
 * 本模块不依赖 React；DOM 依赖仅 CanvasRenderingContext2D / Path2D 类型
 * （Node 单测环境无 Path2D → path2d 为 null，绘制自动回退逐点折线）。
 */
import { getPlotRender, plotSignature, setPlotRender } from './cache';
import { derivativeOf, integralOf, tangentOf } from './calculus';
import { beautifyEquation } from './label';
import { parseEquation } from './parse';
import { sampleEquation, sampleExplicitMulti } from './sample';
import type { MathPlotOverlay, MathViewport, Polyline } from './types';
import { zhT, type LibT } from '../../i18n/lib';

/** §6.1 各层默认色（与 MiniPreview / 交互原型一致）。 */
export const PLOT_COLORS = {
  cardBg: 'rgba(255,255,255,0.88)',
  cardBorder: '#e5e7eb',
  grid: '#e5e7eb',
  axis: '#9ca3af',
  tick: '#6b7280',
  curveFallback: '#3B82F6',
  chipBg: 'rgba(59,130,246,0.08)',
  chipText: '#3B82F6',
  errorBorder: '#ef4444',
  errorText: '#ef4444',
  errorSub: '#6b7280',
  errorHint: '#9ca3af',
  /** ZOO-189 T2 叠加层色：f′ 虚线橙 / 切线绿（与 12 色板同源，白底可读） */
  overlayDerivative: '#F97316',
  overlayTangent: '#22C55E',
  /** ZOO-190 T3 定积分：着色区上面积 chip 的底色（元素色文字、白底可读） */
  integralChipBg: 'rgba(255,255,255,0.92)',
  /** ZOO-190 T3 定积分奇点报错 chip（红字白底，口径同错误占位） */
  integralErrorText: '#ef4444',
} as const;

/** 网格线最小像素间距，低于此密度整层隐藏（亚像素网格，§6.1 第 2 层）。 */
export const MIN_GRID_PX = 8;
/** 刻度数字标签最小像素间距（比网格更稀，防文字拥挤）。 */
export const MIN_TICK_LABEL_PX = 40;

export interface PlotStyle {
  strokeColor: string;
  /** 局部 px 单位（与白板元素 strokeWidth 同语义，外层 scale 后即屏幕线宽） */
  strokeWidth: number;
  opacity: number;
}

/** f′ 叠加虚线节律（局部 px；SVG 导出 join(',') 同款）。 */
export const OVERLAY_DERIVATIVE_DASH: readonly number[] = [8, 5];

/**
 * ZOO-190 T3 定积分着色透明度（元素色 × 0.18；颜色不进渲染缓存签名——
 * 改颜色只重新 fill，不触发重采样，性能契约延续 §6.3）。
 */
export const OVERLAY_INTEGRAL_FILL_ALPHA = 0.18;

/**
 * 叠加层数字标注格式（切线斜率 / 切点，ZOO-189）：≤2 位小数、去尾零——
 * canvas 与 SVG 导出共用，保证两渲染面文本一致。
 */
export function formatOverlayNumber(v: number): string {
  let s = v.toFixed(2);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * 面积值格式化（ZOO-190 T3，风格对齐 formatTickLabel：按数值量级定小数位
 * 〔0.001 级 3 位、1/3 级 3 位、百级 0–2 位〕、去尾零、−0 归 0）——canvas 与
 * SVG 导出共用，保证两渲染面文本一致。
 */
export function formatAreaValue(v: number): string {
  const decimals = Math.max(0, Math.min(4, 2 - Math.floor(Math.log10(Math.abs(v) || 1))));
  let s = v.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** 解析输入契约（4d 的 MathPlotElement 数学字段的子集）。 */
export interface PlotSpec {
  equation: string;
  kind: 'explicit' | 'line' | 'linePair' | 'point' | 'parabola' | 'hyperbola' | 'circle' | 'ellipse' | 'parametric' | 'polar' | 'error';
  errorMessage?: string;
  /** x 定义域（显式函数的绘制域；几何方程忽略、由采样包围盒决定；参数式 / 极坐标复用为 t/θ 域〔ZOO-191 T4〕） */
  xAxis: { min: number; max: number };
  /** x/y 单位等比（圆/椭圆强制 true）：y 视窗 = 定义域按宽高比推导 */
  equalRatio: boolean;
  sampleCount: number;
  /** 符号常量绑定（ZOO-188 T1）：显式路径求值 scope 注入；缺省 = 无常量 */
  constants?: Record<string, number>;
  /**
   * 微积分叠加（ZOO-189 T2）：仅显式函数生效（几何/错误态忽略——parametric /
   * polar 同口径静默忽略、数据保留，方程改回显式即恢复生效〔ZOO-191 T4〕）；
   * 缺省 / 空 = 无叠加，走既有渲染路径（零变化）。进渲染缓存签名（叠加参数是数学输入）。
   */
  overlays?: readonly MathPlotOverlay[];
}

/** 元素外框（局部 px，语义同 rectangle 的 width/height）。 */
export interface PlotFrame {
  width: number;
  height: number;
}

/** 常量绑定的稳定签名（ZOO-188）：键排序后序列化，同内容恒同签名（进渲染 sig）。 */
function constantsSig(constants?: Record<string, number>): string {
  if (!constants) return '';
  return JSON.stringify(
    Object.keys(constants)
      .sort()
      .map((k) => [k, constants[k]]),
  );
}

/**
 * 叠加列表的稳定签名（ZOO-189）：条目字段键排序后序列化，同内容恒同签名
 * （进渲染 sig——切线 x₀ 变化必须重采样，改颜色线宽不在此列、不触发重采样）。
 */
function overlaysSig(overlays?: readonly MathPlotOverlay[]): string {
  if (!overlays || overlays.length === 0) return '';
  return JSON.stringify(
    overlays.map((o) =>
      Object.keys(o)
        .sort()
        .map((k) => [k, (o as unknown as Record<string, unknown>)[k]]),
    ),
  );
}

/** 解析 + 采样 + Path2D 的缓存产物（错误态 error 非空、折线为空）。 */
export interface PlotRender {
  polylines: Polyline[];
  view: MathViewport;
  error?: string;
  path2d: Path2D | null;
  /** ZOO-189 T2 叠加层产物（无叠加时缺省——既有渲染路径零变化） */
  overlays?: OverlayRender;
}

/** 叠加层渲染产物（ZOO-189 T2）：与主曲线同视窗的 f′ 折线 + 切线演示数据。 */
export interface OverlayRender {
  /** f′ 折线（数学坐标）与缓存 Path2D（Node 环境无 Path2D 时为 null） */
  derivative?: { polylines: Polyline[]; path2d: Path2D | null };
  /** 切线：切点 / 斜率 / 贯穿定义域的直线折线（数学坐标） */
  tangent?: { x0: number; y0: number; slope: number; polyline: Polyline };
  /**
   * 定积分（ZOO-190 T3）：着色区闭合折线 + 面积值 + chip 锚点（数学坐标）
   * 与缓存 Path2D；奇点 / 非法区间 → ok:false 携「现象 + 怎么办」文案
   * （画 chip 报错，不产出错误区域，主曲线照常渲染）。
   */
  integral?:
    | { ok: true; value: number; region: Polyline; anchor: { x: number; y: number }; path2d: Path2D | null }
    | { ok: false; error: string };
}

/** 「好看刻度」步长（1/2/2.5/5×10^k，原型 niceStep 平移共享）。 */
export function niceStep(range: number, target: number): number {
  const raw = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * pow + 1e-12) return m * pow;
  }
  return 10 * pow;
}

/**
 * π 轴判定（原型行为：定义域端点落在 π/2 的整数倍附近时用 π 刻度，
 * 如 -2π~2π 预设；普通整数域 [-10,10] 仍用 1/2/5 步长）。
 */
export function axisUsesPi(min: number, max: number): boolean {
  const span = max - min;
  if (!(span > 0) || span > Math.PI * 16) return false;
  for (const v of [min, max]) {
    const half = (v / Math.PI) * 2;
    if (Math.abs(half - Math.round(half)) > 0.04) return false;
    if (Math.abs(Math.round(half)) > 48) return false;
  }
  return true;
}

/**
 * 轴刻度步长：π 轴取 π/4·2^k，普通轴取 niceStep。
 * minPx = 目标最小格宽（主画布卡片默认 45px；MiniPreview 传 8px 保持原型密度）。
 */
export function stepForAxis(min: number, max: number, sizePx: number, minPx = 45): { step: number; pi: boolean } {
  const target = Math.max(sizePx / minPx, 1);
  if (axisUsesPi(min, max)) {
    const base = (max - min) / target;
    for (const m of [0.25, 0.5, 1, 2, 4, 8, 16]) {
      if (m * Math.PI >= base * 0.9) return { step: m * Math.PI, pi: true };
    }
    return { step: 16 * Math.PI, pi: true };
  }
  return { step: niceStep(max - min, target), pi: false };
}

/**
 * 刻度数字格式化：π 轴显示 π 的整数倍 / 小分母分数（π、2π、3π/2），
 * 普通轴按步长有效位数取整并去尾零。
 */
export function formatTickLabel(value: number, pi: boolean, step: number): string {
  if (pi) {
    const k = value / Math.PI;
    if (Math.abs(k) < 0.01) return '0';
    for (const q of [1, 2, 3, 4, 6]) {
      const p = Math.round(k * q);
      if (Math.abs(k * q - p) < 0.02 && p !== 0) {
        const num = p === 1 ? '' : p === -1 ? '-' : String(p);
        return q === 1 ? `${num}π` : `${num}π/${q}`;
      }
    }
  }
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step)) + 1));
  let s = value.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** 数学坐标 → 元素局部 px 映射（§5.2：数学 y 向上，局部 y 向下）。 */
export interface PlotTransform {
  toPxX: (mx: number) => number;
  toPxY: (my: number) => number;
  unitPxX: number;
  unitPxY: number;
}

export function createPlotTransform(view: MathViewport, width: number, height: number): PlotTransform {
  const xSpan = view.xMax - view.xMin || 1;
  const ySpan = view.yMax - view.yMin || 1;
  const unitPxX = width / xSpan;
  const unitPxY = height / ySpan;
  return {
    unitPxX,
    unitPxY,
    toPxX: (mx) => (mx - view.xMin) * unitPxX,
    toPxY: (my) => height - (my - view.yMin) * unitPxY,
  };
}

/** 折线 → 元素局部 px 的 Path2D（断笔 = moveTo；非有限点跳段，双保险）。 */
export function buildPlotPath2D(polylines: Polyline[], t: PlotTransform): Path2D {
  const path = new Path2D();
  for (const pl of polylines) {
    let drawing = false;
    for (const p of pl) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        drawing = false;
        continue;
      }
      const px = t.toPxX(p.x);
      const py = t.toPxY(p.y);
      if (!Number.isFinite(px) || !Number.isFinite(py) || Math.abs(py) > 1e6) {
        drawing = false;
        continue;
      }
      if (drawing) path.lineTo(px, py);
      else path.moveTo(px, py);
      drawing = true;
    }
  }
  return path;
}

/**
 * 闭合折线 → 元素局部 px 的填充 Path2D（ZOO-190 T3 定积分着色区）：整段连续
 * （无断笔语义——区域折线由 integralOf 预扫保证全有限），末尾 closePath 闭合。
 */
export function buildClosedPath2D(points: Polyline, t: PlotTransform): Path2D {
  const path = new Path2D();
  let started = false;
  for (const p of points) {
    const px = t.toPxX(p.x);
    const py = t.toPxY(p.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    if (started) path.lineTo(px, py);
    else path.moveTo(px, py);
    started = true;
  }
  path.closePath();
  return path;
}

/** 圆角矩形路径（手工构建，兼容无 ctx.roundRect 的环境）。 */
function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export interface DrawGraphCoreOptions {
  width: number;
  height: number;
  view: MathViewport;
  polylines: Polyline[];
  /** 缓存 Path2D（局部 px）；null 则逐点折线回退 */
  path2d?: Path2D | null;
  style: PlotStyle;
  showGrid: boolean;
  showAxis: boolean;
  /** 轴上刻度数字（主画布 true / MiniPreview false） */
  tickLabels?: boolean;
  /** 目标格宽：主画布 45px；MiniPreview 传 8 保持原密度 */
  gridTargetPx?: number;
  /** ZOO-189 T2 叠加层（缺省 = 无叠加，绘制路径零变化） */
  overlays?: OverlayRender;
}

/**
 * 图核心（网格 + 十字轴 + 刻度 + 曲线），在 (0,0)-(width,height) 内绘制并裁剪。
 * MiniPreview 与 drawMathPlot 共用 —— 预览即真实渲染（D3）。
 */
export function drawGraphCore(ctx: CanvasRenderingContext2D, opts: DrawGraphCoreOptions): void {
  const { width, height, view, polylines, path2d, style, showGrid, showAxis, tickLabels = false, gridTargetPx = 45, overlays } = opts;
  if (!(width > 0) || !(height > 0)) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  const t = createPlotTransform(view, width, height);
  const sx = stepForAxis(view.xMin, view.xMax, width, gridTargetPx);
  const sy = stepForAxis(view.yMin, view.yMax, height, gridTargetPx);

  // —— 轻网格（线距 < 8px 整层隐藏）——
  if (showGrid) {
    ctx.strokeStyle = PLOT_COLORS.grid;
    ctx.lineWidth = 1;
    if ((sx.step / (view.xMax - view.xMin)) * width >= MIN_GRID_PX) {
      ctx.beginPath();
      for (let v = Math.ceil(view.xMin / sx.step) * sx.step; v <= view.xMax + 1e-9; v += sx.step) {
        const px = Math.round(t.toPxX(v)) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
      }
      ctx.stroke();
    }
    if ((sy.step / (view.yMax - view.yMin)) * height >= MIN_GRID_PX) {
      ctx.beginPath();
      for (let v = Math.ceil(view.yMin / sy.step) * sy.step; v <= view.yMax + 1e-9; v += sy.step) {
        const py = Math.round(t.toPxY(v)) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
      }
      ctx.stroke();
    }
  }

  // —— 过原点十字轴 + 刻度数字（竖轴 x=0 / 横轴 y=0 各自独立判定可见）——
  const vertAxisIn = view.xMin <= 0 && view.xMax >= 0;
  const horizAxisIn = view.yMin <= 0 && view.yMax >= 0;
  if (showAxis && (vertAxisIn || horizAxisIn)) {
    const axisX = Math.round(t.toPxX(0)) + 0.5;
    const axisY = Math.round(t.toPxY(0)) + 0.5;
    ctx.strokeStyle = PLOT_COLORS.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (vertAxisIn) {
      ctx.moveTo(axisX, 0);
      ctx.lineTo(axisX, height);
    }
    if (horizAxisIn) {
      ctx.moveTo(0, axisY);
      ctx.lineTo(width, axisY);
    }
    ctx.stroke();

    if (tickLabels) {
      const strideX = Math.max(1, Math.ceil(MIN_TICK_LABEL_PX / ((sx.step / (view.xMax - view.xMin)) * width || 1)));
      const strideY = Math.max(1, Math.ceil(MIN_TICK_LABEL_PX / ((sy.step / (view.yMax - view.yMin)) * height || 1)));
      ctx.fillStyle = PLOT_COLORS.tick;
      ctx.font = '10px system-ui, sans-serif';
      // x 刻度数字沿横轴下方（横轴可见时）
      if (horizAxisIn) {
        let idx = 0;
        for (let v = Math.ceil(view.xMin / sx.step) * sx.step; v <= view.xMax + 1e-9; v += sx.step, idx++) {
          if (idx % strideX !== 0 || Math.abs(v) < sx.step * 0.01) continue; // 原点由 y 轴侧统一标 0
          const label = formatTickLabel(v, sx.pi, sx.step);
          const px = t.toPxX(v);
          const py = Math.min(Math.max(axisY + 3, 2), height - 12);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, px, py);
        }
      }
      // y 刻度数字沿竖轴左侧（竖轴可见时）
      if (vertAxisIn) {
        let idx = 0;
        let zeroDrawn = false;
        for (let v = Math.ceil(view.yMin / sy.step) * sy.step; v <= view.yMax + 1e-9; v += sy.step, idx++) {
          if (idx % strideY !== 0) continue;
          const isZero = Math.abs(v) < sy.step * 0.01;
          if (isZero) {
            if (zeroDrawn) continue;
            zeroDrawn = true;
          }
          const label = isZero ? '0' : formatTickLabel(v, sy.pi, sy.step);
          const py = t.toPxY(v);
          const px = Math.min(Math.max(axisX - 4, 14), width - 2);
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, px, py);
        }
      }
    }
  }

  // —— ZOO-190 T3 定积分着色（主曲线之下、网格轴之上）：元素色半透明填充，
  //    颜色不进渲染签名——改色仅重新 fill（缓存 Path2D 优先，回退逐点闭合折线）——
  if (overlays?.integral?.ok) {
    const ig = overlays.integral;
    ctx.globalAlpha = style.opacity * OVERLAY_INTEGRAL_FILL_ALPHA;
    ctx.fillStyle = style.strokeColor;
    if (ig.path2d) {
      ctx.fill(ig.path2d);
    } else {
      ctx.beginPath();
      let started = false;
      for (const p of ig.region) {
        const px = t.toPxX(p.x);
        const py = t.toPxY(p.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        if (started) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        started = true;
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  // —— 曲线（缓存 Path2D 优先；颜色线宽不进签名，改样式仅重 stroke）——
  if (polylines.length > 0) {
    ctx.globalAlpha = style.opacity;
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = style.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (path2d) {
      ctx.stroke(path2d);
    } else {
      ctx.beginPath();
      for (const pl of polylines) {
        let drawing = false;
        for (const p of pl) {
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
            drawing = false;
            continue;
          }
          const px = t.toPxX(p.x);
          const py = t.toPxY(p.y);
          if (!Number.isFinite(px) || !Number.isFinite(py) || Math.abs(py) > 1e6) {
            drawing = false;
            continue;
          }
          if (drawing) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
          drawing = true;
        }
      }
      ctx.stroke();
    }
  }

  // —— ZOO-190 T3 面积 chip（主曲线之上）：∫ = 面积值，锚在着色区中线附近、
  //    越界时收拢回卡片内；奇点 / 非法区间 → 顶部报错 chip（现象 + 怎么办）——
  if (overlays?.integral) {
    const ig = overlays.integral;
    ctx.globalAlpha = style.opacity;
    if (ig.ok) {
      const label = `∫ = ${formatAreaValue(ig.value)}`;
      ctx.font = 'italic 11px serif';
      const tw = ctx.measureText(label).width;
      const ch = 16;
      const cx = Math.min(Math.max(t.toPxX(ig.anchor.x), tw / 2 + 4), width - tw / 2 - 4);
      const cy = Math.min(Math.max(t.toPxY(ig.anchor.y), ch / 2 + 4), height - ch / 2 - 4);
      ctx.fillStyle = PLOT_COLORS.integralChipBg;
      roundedRectPath(ctx, cx - tw / 2 - 5, cy - ch / 2, tw + 10, ch, 8);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = style.strokeColor;
      ctx.fillText(label, cx, cy + 0.5);
    } else {
      const wrapChip = (text: string, maxWidth: number): string[] => {
        const lines: string[] = [];
        let line = '';
        for (const ch of text) {
          if (ctx.measureText(line + ch).width > maxWidth) {
            lines.push(line);
            line = ch;
          } else {
            line += ch;
          }
        }
        if (line) lines.push(line);
        return lines.slice(0, 2); // 与错误占位同款：至多两行，超长截断
      };
      ctx.font = '10px system-ui, sans-serif';
      const lines = wrapChip(`⚠ ${ig.error}`, width - 16);
      const lw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10;
      const lh = lines.length * 12 + 6;
      const bx = Math.min(Math.max(width / 2 - lw / 2, 4), Math.max(width - lw - 4, 4));
      ctx.fillStyle = PLOT_COLORS.integralChipBg;
      roundedRectPath(ctx, bx, 6, lw, lh, 6);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = PLOT_COLORS.integralErrorText;
      let ly = 6 + 3;
      for (const l of lines) {
        ctx.fillText(l, bx + lw / 2, ly);
        ly += 12;
      }
    }
  }

  // —— ZOO-189 T2 叠加层（主曲线之后）：f′ 虚线橙 → 切线绿（切点标记 + 斜率标注）——
  if (overlays?.derivative) {
    const d = overlays.derivative;
    ctx.globalAlpha = style.opacity;
    ctx.strokeStyle = PLOT_COLORS.overlayDerivative;
    ctx.lineWidth = style.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([...OVERLAY_DERIVATIVE_DASH]);
    if (d.path2d) {
      ctx.stroke(d.path2d);
    } else {
      ctx.beginPath();
      for (const pl of d.polylines) {
        let drawing = false;
        for (const p of pl) {
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
            drawing = false;
            continue;
          }
          const px = t.toPxX(p.x);
          const py = t.toPxY(p.y);
          if (!Number.isFinite(px) || !Number.isFinite(py) || Math.abs(py) > 1e6) {
            drawing = false;
            continue;
          }
          if (drawing) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
          drawing = true;
        }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (overlays?.tangent) {
    const tg = overlays.tangent;
    ctx.globalAlpha = style.opacity;
    ctx.strokeStyle = PLOT_COLORS.overlayTangent;
    ctx.lineWidth = Math.max(style.strokeWidth * 0.75, 1);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(t.toPxX(tg.polyline[0].x), t.toPxY(tg.polyline[0].y));
    ctx.lineTo(t.toPxX(tg.polyline[1].x), t.toPxY(tg.polyline[1].y));
    ctx.stroke();

    // 切点标记：绿底白边圆点
    const px = t.toPxX(tg.x0);
    const py = t.toPxY(tg.y0);
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = PLOT_COLORS.overlayTangent;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // 斜率标注（数学记号，语言无关）：f′(x₀) = k，越界时向左翻转
    const label = `f′(${formatOverlayNumber(tg.x0)}) = ${formatOverlayNumber(tg.slope)}`;
    ctx.font = 'italic 10px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    let lx = px + 9;
    if (lx + tw > width - 3) lx = px - 9 - tw;
    let ly = py - 8;
    if (ly < 10) ly = py + 14;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = PLOT_COLORS.overlayTangent;
    ctx.fillText(label, lx, ly);
  }

  ctx.restore();
}

export interface DrawMathPlotOptions {
  /** 卡片左上角（当前变换空间）与外框尺寸 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** resolvePlotRender 产物 */
  render: PlotRender;
  style: PlotStyle;
  showAxis: boolean;
  showGrid: boolean;
  showLabel: boolean;
  /** 方程原文（内部经 beautifyEquation 美化） */
  equation: string;
  /** ZOO-176：错误占位提示文案翻译器（缺省中文，画布 / 演示台按语言传入） */
  t?: LibT;
}

/**
 * MathPlot 卡片整绘（§6.1 自底向上）：半透明白底 →（核心：网格/轴/曲线）→
 * 左下角方程 chip；错误态画红色虚线占位框 + 原因 + 重编辑提示。
 * 绘制在 (x,y)-(x+width,y+height)，全部矢量（Path2D / 图形指令）。
 */
export function drawMathPlot(ctx: CanvasRenderingContext2D, opts: DrawMathPlotOptions): void {
  const { x, y, width, height, render, style, equation } = opts;
  if (!(width > 0) || !(height > 0)) return;

  // 第 1 层：半透明白底 + 细边（点阵背景上保证可读，原型决策 3）
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = PLOT_COLORS.cardBg;
  roundedRectPath(ctx, x, y, width, height, 8);
  ctx.fill();
  ctx.strokeStyle = PLOT_COLORS.cardBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (render.error) {
    drawErrorPlaceholder(ctx, x, y, width, height, render.error, equation, opts.t);
    ctx.restore();
    return;
  }

  // 第 2–4 层：核心图（在卡片内嵌区域绘制，四周留 6px 内边距）
  const pad = 6;
  ctx.translate(x + pad, y + pad);
  drawGraphCore(ctx, {
    width: width - pad * 2,
    height: height - pad * 2,
    view: render.view,
    polylines: render.polylines,
    path2d: render.path2d,
    style,
    showGrid: opts.showGrid,
    showAxis: opts.showAxis,
    tickLabels: true,
    overlays: render.overlays,
  });
  ctx.translate(-x - pad, -y - pad);

  // 第 5 层：左下角方程标签 chip
  if (opts.showLabel) {
    const text = beautifyEquation(equation);
    ctx.font = '11px serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(text).width;
    const ch = 18;
    const cw = tw + 14;
    const cy = y + height - 4;
    ctx.fillStyle = PLOT_COLORS.chipBg;
    roundedRectPath(ctx, x + 6, cy - ch, cw, ch, 9);
    ctx.fill();
    ctx.fillStyle = PLOT_COLORS.chipText;
    ctx.fillText(text, x + 13, cy - 4);

    // 双色图例 chip（ZOO-189）：f 实线（元素色）/ f′ 虚线橙，紧随方程 chip，
    // 仅 f′ 叠加时出现。先量宽 → chip 底 → 样本线 → 标签（底在下、线在上）。
    if (render.overlays?.derivative) {
      const sw = 14; // 样本线长
      ctx.font = 'italic 11px serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const fW = ctx.measureText('f').width;
      const fdW = ctx.measureText('f′').width;
      const swLine = Math.min(Math.max(style.strokeWidth, 1.5), 3);
      const gap = 8;
      const lw = 7 + sw + 3 + fW + gap + sw + 3 + fdW + 5;
      const lx = x + 6 + cw + 6;
      const midY = cy - ch / 2;
      ctx.fillStyle = PLOT_COLORS.chipBg;
      roundedRectPath(ctx, lx, cy - ch, lw, ch, 9);
      ctx.fill();

      let cx0 = lx + 7;
      ctx.lineWidth = swLine;
      ctx.setLineDash([]);
      ctx.strokeStyle = style.strokeColor;
      ctx.beginPath();
      ctx.moveTo(cx0, midY);
      ctx.lineTo(cx0 + sw, midY);
      ctx.stroke();
      ctx.fillStyle = style.strokeColor;
      ctx.fillText('f', cx0 + sw + 3, midY + 0.5);
      cx0 += sw + 3 + fW + gap;

      ctx.strokeStyle = PLOT_COLORS.overlayDerivative;
      ctx.setLineDash([...OVERLAY_DERIVATIVE_DASH]);
      ctx.beginPath();
      ctx.moveTo(cx0, midY);
      ctx.lineTo(cx0 + sw, midY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = PLOT_COLORS.overlayDerivative;
      ctx.fillText('f′', cx0 + sw + 3, midY + 0.5);
    }
  }
  ctx.restore();
}

/** 错误态占位（§6.1）：红虚线框 + ⚠ 原因 + 原方程 + 重编辑提示。 */
function drawErrorPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  message: string,
  equation: string,
  t: LibT = zhT,
): void {
  ctx.save();
  ctx.strokeStyle = PLOT_COLORS.errorBorder;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  roundedRectPath(ctx, x + 4, y + 4, width - 8, height - 8, 8);
  ctx.stroke();
  ctx.setLineDash([]);

  // 逐字符折行（与 MiniPreview 错误文案同款）
  const wrap = (text: string, maxWidth: number): string[] => {
    const lines: string[] = [];
    let line = '';
    for (const ch of text) {
      if (ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const maxWidth = width - 32;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = x + width / 2;
  ctx.font = 'bold 12px system-ui, sans-serif';
  const msgLines = wrap(`⚠ ${message}`, maxWidth).slice(0, 2);
  ctx.font = '11px system-ui, sans-serif';
  const eqLines = wrap(beautifyEquation(equation), maxWidth).slice(0, 1);
  const total = msgLines.length + eqLines.length + 1;
  let ly = y + height / 2 - ((total - 1) * 15) / 2;

  ctx.fillStyle = PLOT_COLORS.errorText;
  ctx.font = 'bold 12px system-ui, sans-serif';
  for (const l of msgLines) {
    ctx.fillText(l, cx, ly);
    ly += 15;
  }
  ctx.fillStyle = PLOT_COLORS.errorSub;
  ctx.font = '11px system-ui, sans-serif';
  for (const l of eqLines) {
    ctx.fillText(l, cx, ly);
    ly += 15;
  }
  ctx.fillStyle = PLOT_COLORS.errorHint;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText(t('math.errorHint'), cx, ly);
  ctx.restore();
}

/**
 * 解析 + 采样 + Path2D 构建（带 §6.3 WeakMap 缓存）—— 4c 渲染管线统一入口，
 * 4d 元素集成时 renderElement case 'mathPlot' 直接调用本函数。
 *
 * cacheKey 用元素对象引用（store 不可变更新换引用 → 旧缓存自然回收）；
 * sig 只含数学输入：平移缩放 / 改颜色线宽透明度 / 轴网显隐均命中缓存。
 */
export function resolvePlotRender(spec: PlotSpec, frame: PlotFrame, cacheKey: object): PlotRender {
  const sig = plotSignature({
    equation: spec.equation,
    kind: spec.kind,
    xMin: spec.xAxis.min,
    xMax: spec.xAxis.max,
    equalRatio: spec.equalRatio,
    sampleCount: spec.sampleCount,
    // ZOO-188：常量是数学输入（改值必须重采样）；键序规范化，避免同内容异序误判失效
    constants: constantsSig(spec.constants),
    // ZOO-189：叠加参数是数学输入（f′ 开关 / 切线 x₀ 变化必须重算）；改颜色
    // 线宽不在 sig——不触发重采样（性能契约延续 §6.3）
    overlays: overlaysSig(spec.overlays),
    width: frame.width,
    height: frame.height,
  });
  const hit = getPlotRender(cacheKey);
  if (hit && hit.sig === sig) return hit;

  const stored = { sig, ...computePlotRender(spec, frame) };
  setPlotRender(cacheKey, stored);
  return stored;
}

function computePlotRender(spec: PlotSpec, frame: PlotFrame): PlotRender {
  const nominal: MathViewport = { xMin: spec.xAxis.min, xMax: spec.xAxis.max, yMin: -6, yMax: 6 };
  if (spec.kind === 'error') {
    return { polylines: [], view: nominal, error: spec.errorMessage || zhT('math.unrecognized'), path2d: null };
  }

  const yWindow = spec.equalRatio
    ? (() => {
        const span = (spec.xAxis.max - spec.xAxis.min) * (frame.height / Math.max(frame.width, 1));
        return { yMin: -span / 2, yMax: span / 2 };
      })()
    : undefined;

  const parsed = parseEquation(spec.equation, zhT, spec.constants);

  // —— ZOO-189 T2 叠加路径：仅显式函数且 overlays 非空时进入（惰性求导——
  //    无叠加元素不走此分支，既有渲染路径零变化）。f′ / 切线共用一次求导；
  //    ZOO-190 T3：定积分只依赖 f 本身（纯数值辛普森），积分-only 时不求导。
  if (parsed.kind === 'explicit' && spec.overlays && spec.overlays.length > 0) {
    const wantsDerivative = spec.overlays.some((o) => o.type === 'derivative');
    const tangentOverlay = spec.overlays.find((o): o is { type: 'tangent'; x0: number } => o.type === 'tangent');
    const integralOverlay = spec.overlays.find((o): o is { type: 'integral'; a: number; b: number } => o.type === 'integral');
    const deriv = wantsDerivative || tangentOverlay ? derivativeOf(spec.equation, { constants: spec.constants }) : null;
    const dfn = deriv && deriv.ok ? deriv.fn : null;
    if (wantsDerivative || tangentOverlay || integralOverlay) {
      const sampled = sampleExplicitMulti(
        [parsed.fn, ...(wantsDerivative && dfn ? [dfn] : [])],
        {
          xMin: spec.xAxis.min,
          xMax: spec.xAxis.max,
          ...(yWindow ?? {}),
        },
        spec.sampleCount,
      );
      if ('error' in sampled) {
        return { polylines: [], view: nominal, error: sampled.error, path2d: null };
      }
      const view: MathViewport = {
        xMin: sampled.xMin ?? spec.xAxis.min,
        xMax: sampled.xMax ?? spec.xAxis.max,
        yMin: sampled.yMin,
        yMax: sampled.yMax,
      };
      const transform =
        typeof Path2D !== 'undefined' ? createPlotTransform(view, frame.width, frame.height) : null;
      const overlays: OverlayRender = {};
      if (wantsDerivative && dfn && sampled.series[1]) {
        overlays.derivative = {
          polylines: sampled.series[1],
          path2d: transform ? buildPlotPath2D(sampled.series[1], transform) : null,
        };
      }
      if (tangentOverlay && dfn) {
        const tg = tangentOf(parsed.fn, dfn, tangentOverlay.x0, view.xMin, view.xMax);
        if (tg) overlays.tangent = tg;
      }
      // ZOO-190 T3：f 与积分带共窗（着色区跟随主曲线视窗）；奇点 → 错误 chip 载荷
      if (integralOverlay) {
        const ig = integralOf(parsed.fn, integralOverlay.a, integralOverlay.b);
        overlays.integral = ig.ok
          ? {
              ok: true,
              value: ig.value,
              region: ig.region,
              anchor: ig.anchor,
              path2d: transform ? buildClosedPath2D(ig.region, transform) : null,
            }
          : { ok: false, error: ig.message };
      }
      return {
        polylines: sampled.series[0],
        view,
        path2d: transform ? buildPlotPath2D(sampled.series[0], transform) : null,
        ...(Object.keys(overlays).length > 0 ? { overlays } : {}),
      };
    }
  }

  const sampled = sampleEquation(parsed, {
    xMin: spec.xAxis.min,
    xMax: spec.xAxis.max,
    ...(yWindow ?? {}),
    sampleCount: spec.sampleCount,
    // 几何 kind 视窗与卡片纵横比一致（ZOO-147 等比修复）：显式路径忽略该参数
    aspect: frame.height / Math.max(frame.width, 1),
  });
  if ('error' in sampled) {
    return { polylines: [], view: nominal, error: sampled.error, path2d: null };
  }
  const view: MathViewport = {
    xMin: sampled.xMin ?? spec.xAxis.min,
    xMax: sampled.xMax ?? spec.xAxis.max,
    yMin: sampled.yMin,
    yMax: sampled.yMax,
  };
  const path2d =
    typeof Path2D !== 'undefined' ? buildPlotPath2D(sampled.polylines, createPlotTransform(view, frame.width, frame.height)) : null;
  return { polylines: sampled.polylines, view, path2d };
}
