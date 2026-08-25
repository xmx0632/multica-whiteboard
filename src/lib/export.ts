import { WhiteboardElement, PathElement, RectangleElement, CircleElement, LineElement, ArrowElement, TextElement, MathPlotElement, FrameElement } from './types';
import { renderElement, drawFrame, getAllElementsBounds, mathPlotSpecOf, diamondVertices } from './renderer';
import { zhT, type LibT } from '../i18n/lib';
import {
  formatAreaValue,
  formatOverlayNumber,
  formatTickLabel,
  MIN_GRID_PX,
  MIN_TICK_LABEL_PX,
  OVERLAY_DERIVATIVE_DASH,
  OVERLAY_INTEGRAL_FILL_ALPHA,
  PIECEWISE_MARK_RADIUS_PX,
  PLOT_COLORS,
  resolvePlotRender,
  stepForAxis,
} from './math/plot';
import { formatPoiCoord } from './math/poi';
import { resolveDragPoints } from './math/dragPoint';
import { PHYSICS_GUIDE_DASH, PHYSICS_MARK_RADIUS_PX } from './math/physics';
import { CONIC_GUIDE_DASH, CONIC_MARK_RADIUS_PX } from './math/conicMarks';
import { plotTokenFor } from './math/cache';
import { beautifyEquation } from './math/label';
import { dashPatternFor } from './stroke';
import { lineVertices, isPolyline } from './polyline';
import { isFrame, frameContents, frameExportRegion } from './frame';

export interface ExportOptions {
  format: 'png' | 'jpg' | 'svg';
  scale: number;
  background: string | 'transparent';
  padding: number;
}

const DEFAULT_OPTIONS: ExportOptions = {
  format: 'png',
  scale: 2,
  background: '#ffffff',
  padding: 40,
};

function pathToSvgPath(el: PathElement): string {
  if (el.points.length < 2) return '';
  const pts = el.points;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  if (pts.length === 2) {
    d += ` L ${pts[1].x} ${pts[1].y}`;
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const pn = pts[i + 1];
      const mx = (p.x + pn.x) / 2;
      const my = (p.y + pn.y) / 2;
      d += ` Q ${p.x} ${p.y} ${mx} ${my}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last.x} ${last.y}`;
  }
  return d;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 线型 → SVG stroke-dasharray 属性片段（ZOO-165）：solid 返回空串保持既有输出 */
function svgDashAttr(el: WhiteboardElement): string {
  const pattern = dashPatternFor(el.dash, el.strokeWidth);
  return pattern.length > 0 ? ` stroke-dasharray="${pattern.join(',')}"` : '';
}

function elementToSvg(el: WhiteboardElement, t: LibT = zhT): string {
  const opacity = el.opacity < 1 ? ` opacity="${el.opacity}"` : '';

  switch (el.type) {
    case 'path':
      return `<path d="${pathToSvgPath(el)}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}"${svgDashAttr(el)} fill="none" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`;
    case 'rectangle':
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}"${svgDashAttr(el)}${el.fillColor ? ` fill="${el.fillColor}"` : ' fill="none"'}${opacity}/>`;
    case 'circle': {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const rx = el.width / 2;
      const ry = el.height / 2;
      return `<ellipse cx="${cx}" cy="${cy}" rx="${Math.abs(rx)}" ry="${Math.abs(ry)}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}"${svgDashAttr(el)}${el.fillColor ? ` fill="${el.fillColor}"` : ' fill="none"'}${opacity}/>`;
    }
    // 菱形（ZOO-217）：四中点顶点 <polygon>（与画布 diamondVertices 同一份推导；
    // PNG/缩略图走 renderElement 自动同语义）
    case 'diamond':
      return `<polygon points="${diamondVertices(el).map((p) => `${p.x},${p.y}`).join(' ')}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}"${svgDashAttr(el)}${el.fillColor ? ` fill="${el.fillColor}"` : ' fill="none"'} stroke-linejoin="round"${opacity}/>`;
    case 'line':
      return isPolyline(el)
        ? `<polyline points="${lineVertices(el).map((p) => `${p.x},${p.y}`).join(' ')}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}"${svgDashAttr(el)} fill="none" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`
        : `<line x1="${el.x}" y1="${el.y}" x2="${el.x2}" y2="${el.y2}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}"${svgDashAttr(el)} stroke-linecap="round"${opacity}/>`;
    case 'arrow': {
      // 折线形态（ZOO-168）：主体 polyline，箭头跟随最后一段方向（PNG/缩略图走
      // renderElement 同语义）；两点直线保持既有 <line> 输出
      const pts = lineVertices(el);
      const n = pts.length;
      const headLen = Math.max(10, el.strokeWidth * 4);
      const angle = Math.atan2(pts[n - 1].y - pts[n - 2].y, pts[n - 1].x - pts[n - 2].x);
      const x2 = pts[n - 1].x;
      const y2 = pts[n - 1].y;
      const ax1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const ay1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const ax2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const ay2 = y2 - headLen * Math.sin(angle + Math.PI / 6);
      const body = isPolyline(el)
        ? `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}"${svgDashAttr(el)} fill="none" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`
        : `<line x1="${el.x}" y1="${el.y}" x2="${el.x2}" y2="${el.y2}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}"${svgDashAttr(el)} stroke-linecap="round"${opacity}/>`;
      return body +
        `<polygon points="${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}" fill="${el.strokeColor}"${opacity}/>`;
    }
    case 'text': {
      const lines = el.content.split('\n');
      const lineHeight = el.fontSize * 1.3;
      const tspans = lines.map((line, i) =>
        `<tspan x="${el.x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
      ).join('');
      return `<text x="${el.x}" y="${el.y}" font-size="${el.fontSize}" font-family="${el.fontFamily || 'sans-serif'}" fill="${el.color}"${opacity}>${tspans}</text>`;
    }
    case 'mathPlot':
      return mathPlotToSvg(el, t);
    case 'frame':
      // 帧 SVG（ZOO-198）：白底页框 + 上缘页名（与 drawFrame 同一套视觉常量）
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"${opacity}/>` +
        `<text x="${el.x}" y="${el.y - 10}" font-size="13" font-weight="600" font-family="system-ui, sans-serif" fill="#64748b"${opacity}>${escapeXml(el.name)}</text>`;
    default:
      return '';
  }
}

/**
 * MathPlot 元素 → SVG（技术方案 §5.3：轴/网格/曲线 → path+line，标签 → text）。
 * 与 drawGraphCore / drawMathPlot 同一套数据（resolvePlotRender 缓存折线）与
 * 同一套可见性规则（网格最小像素间距、刻度抽稀），坐标 = 元素局部 px + el.x/y。
 */
function mathPlotToSvg(el: MathPlotElement, t: LibT): string {
  const { x, y, width: w, height: h } = el;
  if (!(w > 0) || !(h > 0)) return '';
  const opacity = el.opacity < 1 ? ` opacity="${el.opacity}"` : '';

  const render = resolvePlotRender(mathPlotSpecOf(el), { width: w, height: h }, plotTokenFor(el.id));

  const parts: string[] = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="rgba(255,255,255,0.88)" stroke="#e5e7eb" stroke-width="1"${opacity}/>`
  ];

  if (render.error) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    parts.push(`<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="8" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="6,4"/>`);
    parts.push(`<text x="${cx}" y="${cy - 14}" font-size="12" font-weight="bold" font-family="system-ui, sans-serif" fill="#ef4444" text-anchor="middle">⚠ ${escapeXml(clip(render.error, 44))}</text>`);
    parts.push(`<text x="${cx}" y="${cy + 2}" font-size="11" font-family="system-ui, sans-serif" fill="#6b7280" text-anchor="middle">${escapeXml(clip(beautifyEquation(el.equation), 44))}</text>`);
    parts.push(`<text x="${cx}" y="${cy + 18}" font-size="10" font-family="system-ui, sans-serif" fill="#9ca3af" text-anchor="middle">${escapeXml(t('math.errorHint'))}</text>`);
    return parts.join('');
  }

  // 内嵌绘图区（四周 6px 内边距，与 drawMathPlot 一致）
  const pad = 6;
  const gx = x + pad;
  const gy = y + pad;
  const gw = w - pad * 2;
  const gh = h - pad * 2;
  const view = render.view;
  const unitX = gw / (view.xMax - view.xMin || 1);
  const unitY = gh / (view.yMax - view.yMin || 1);
  const toX = (mx: number) => gx + (mx - view.xMin) * unitX;
  const toY = (my: number) => gy + gh - (my - view.yMin) * unitY;

  const sx = stepForAxis(view.xMin, view.xMax, gw, 45);
  const sy = stepForAxis(view.yMin, view.yMax, gh, 45);

  const gridLines: string[] = [];
  if (el.showGrid) {
    if ((sx.step / (view.xMax - view.xMin)) * gw >= MIN_GRID_PX) {
      for (let v = Math.ceil(view.xMin / sx.step) * sx.step; v <= view.xMax + 1e-9; v += sx.step) {
        const px = toX(v).toFixed(1);
        gridLines.push(`<line x1="${px}" y1="${gy}" x2="${px}" y2="${gy + gh}" stroke="#e5e7eb" stroke-width="1"/>`);
      }
    }
    if ((sy.step / (view.yMax - view.yMin)) * gh >= MIN_GRID_PX) {
      for (let v = Math.ceil(view.yMin / sy.step) * sy.step; v <= view.yMax + 1e-9; v += sy.step) {
        const py = toY(v).toFixed(1);
        gridLines.push(`<line x1="${gx}" y1="${py}" x2="${gx + gw}" y2="${py}" stroke="#e5e7eb" stroke-width="1"/>`);
      }
    }
  }
  parts.push(...gridLines);

  const vertAxisIn = view.xMin <= 0 && view.xMax >= 0;
  const horizAxisIn = view.yMin <= 0 && view.yMax >= 0;
  if (el.showAxis && (vertAxisIn || horizAxisIn)) {
    if (vertAxisIn) parts.push(`<line x1="${toX(0).toFixed(1)}" y1="${gy}" x2="${toX(0).toFixed(1)}" y2="${gy + gh}" stroke="#9ca3af" stroke-width="1"/>`);
    if (horizAxisIn) parts.push(`<line x1="${gx}" y1="${toY(0).toFixed(1)}" x2="${gx + gw}" y2="${toY(0).toFixed(1)}" stroke="#9ca3af" stroke-width="1"/>`);

    const strideX = Math.max(1, Math.ceil(MIN_TICK_LABEL_PX / ((sx.step / (view.xMax - view.xMin)) * gw || 1)));
    const strideY = Math.max(1, Math.ceil(MIN_TICK_LABEL_PX / ((sy.step / (view.yMax - view.yMin)) * gh || 1)));
    const labels: string[] = [];
    const axisY = toY(0);
    const axisX = toX(0);
    if (horizAxisIn) {
      let idx = 0;
      for (let v = Math.ceil(view.xMin / sx.step) * sx.step; v <= view.xMax + 1e-9; v += sx.step, idx++) {
        if (idx % strideX !== 0 || Math.abs(v) < sx.step * 0.01) continue;
        const px = Math.min(Math.max(toX(v), gx + 4), gx + gw - 4);
        const py = Math.min(Math.max(axisY + 3, gy + 2), gy + gh - 10);
        labels.push(`<text x="${px.toFixed(1)}" y="${(py + 9).toFixed(1)}" font-size="10" font-family="system-ui, sans-serif" fill="#6b7280" text-anchor="middle">${escapeXml(formatTickLabel(v, sx.pi, sx.step))}</text>`);
      }
    }
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
        const py = Math.min(Math.max(toY(v), gy + 5), gy + gh - 3);
        const px = Math.min(Math.max(axisX - 4, gx + 14), gx + gw - 2);
        labels.push(`<text x="${px.toFixed(1)}" y="${(py + 3.5).toFixed(1)}" font-size="10" font-family="system-ui, sans-serif" fill="#6b7280" text-anchor="end">${escapeXml(isZero ? '0' : formatTickLabel(v, sy.pi, sy.step))}</text>`);
      }
    }
    parts.push(...labels);
  }

  // 折线 → path d（主曲线与 f′ 叠加共用；断笔 = M，与 canvas buildPlotPath2D 同款）
  const polylinesToD = (polylines: { x: number; y: number }[][]) => {
    let d = '';
    for (const pl of polylines) {
      let drawing = false;
      for (const p of pl) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          drawing = false;
          continue;
        }
        const px = toX(p.x);
        const py = toY(p.y);
        if (!Number.isFinite(px) || !Number.isFinite(py) || Math.abs(py) > 1e6) {
          drawing = false;
          continue;
        }
        d += `${drawing ? 'L' : 'M'} ${px.toFixed(2)} ${py.toFixed(2)} `;
        drawing = true;
      }
    }
    return d.trim();
  };
  const hasOverlayDraw = Boolean(render.overlays?.derivative || render.overlays?.tangent || render.overlays?.integral || render.overlays?.physics || render.overlays?.conic);
  const d = polylinesToD(render.polylines);
  if (d || hasOverlayDraw) {
    // 曲线裁剪到内嵌绘图区（ZOO-147）：几何 kind 采样刻意越出卡片（贯穿边缘），
    // canvas 有 ctx.clip 而 SVG 需显式 clipPath，否则导出的直线/双曲线溢出卡片
    parts.push(`<defs><clipPath id="mpc-${el.id}"><rect x="${gx}" y="${gy}" width="${gw}" height="${gh}"/></clipPath></defs>`);

    // —— ZOO-190 T3 定积分着色区（主曲线之下，与 canvas 绘制序一致）：曲线
    //    [a,b] 段 + 基线 y=0 闭合 → <polygon>；元素色 × fill-opacity 组合元素透明度——
    if (render.overlays?.integral?.ok) {
      const pts = render.overlays.integral.region
        .map((p) => `${toX(p.x).toFixed(2)},${toY(p.y).toFixed(2)}`)
        .join(' ');
      parts.push(
        `<polygon points="${pts}" fill="${el.strokeColor}" fill-opacity="${OVERLAY_INTEGRAL_FILL_ALPHA}" clip-path="url(#mpc-${el.id})"${opacity}/>`,
      );
    }

    if (d) {
      parts.push(`<path d="${d}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#mpc-${el.id})"${opacity}/>`);
    }

    // —— ZOO-216 分段端点标记（主曲线之后，与 canvas 绘制序一致）：元素色
    //    实心 / 白底描边空心小圆点（空心白底保证网格背景上可辨——评审补充）。
    if (render.piecewiseMarks && render.piecewiseMarks.length > 0) {
      for (const m of render.piecewiseMarks) {
        const px = toX(m.x);
        const py = toY(m.y);
        if (!Number.isFinite(px) || !Number.isFinite(py) || px < gx || px > gx + gw || py < gy || py > gy + gh) continue;
        parts.push(
          `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${PIECEWISE_MARK_RADIUS_PX}" fill="${m.filled ? el.strokeColor : '#ffffff'}" stroke="${el.strokeColor}" stroke-width="1.5"${opacity}/>`,
        );
      }
    }

    // —— ZOO-189 T2 叠加层（与 drawGraphCore 同一套数据与配色）——
    if (render.overlays?.derivative) {
      const dd = polylinesToD(render.overlays.derivative.polylines);
      if (dd) {
        parts.push(
          `<path d="${dd}" stroke="${PLOT_COLORS.overlayDerivative}" stroke-width="${el.strokeWidth}" stroke-dasharray="${OVERLAY_DERIVATIVE_DASH.join(',')}" fill="none" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#mpc-${el.id})"${opacity}/>`,
        );
      }
    }
    if (render.overlays?.tangent) {
      const tg = render.overlays.tangent;
      const a = tg.polyline[0];
      const b = tg.polyline[1];
      parts.push(
        `<line x1="${toX(a.x).toFixed(2)}" y1="${toY(a.y).toFixed(2)}" x2="${toX(b.x).toFixed(2)}" y2="${toY(b.y).toFixed(2)}" stroke="${PLOT_COLORS.overlayTangent}" stroke-width="${Math.max(el.strokeWidth * 0.75, 1)}" stroke-linecap="round" clip-path="url(#mpc-${el.id})"${opacity}/>`,
      );
      const px = toX(tg.x0);
      const py = toY(tg.y0);
      parts.push(
        `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="4" fill="${PLOT_COLORS.overlayTangent}" stroke="#ffffff" stroke-width="1.5"${opacity}/>`,
      );
      // 斜率标注（与 canvas 同格式；越界时向左翻转）
      const label = `f′(${formatOverlayNumber(tg.x0)}) = ${formatOverlayNumber(tg.slope)}`;
      const labelW = label.length * 5.4;
      let lx = px + 9;
      if (lx + labelW > gx + gw - 3) lx = px - 9 - labelW;
      let ly = py - 3;
      if (ly < gy + 10) ly = py + 14;
      parts.push(
        `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-size="10" font-style="italic" font-family="system-ui, sans-serif" fill="${PLOT_COLORS.overlayTangent}" text-anchor="start">${escapeXml(label)}</text>`,
      );
    }

    // —— ZOO-190 T3 面积 chip / 奇点报错 chip（与 canvas 同一套锚点与配色）——
    if (render.overlays?.integral) {
      const ig = render.overlays.integral;
      if (ig.ok) {
        const chip = `∫ = ${formatAreaValue(ig.value)}`;
        const tw = chip.length * 6.2 + 10; // italic serif 11px 估宽（图例 chip 同款口径）
        const ch = 16;
        let cx = toX(ig.anchor.x);
        let cy = toY(ig.anchor.y);
        cx = Math.min(Math.max(cx, gx + tw / 2 + 4), gx + gw - tw / 2 - 4);
        cy = Math.min(Math.max(cy, gy + ch / 2 + 4), gy + gh - ch / 2 - 4);
        parts.push(
          `<rect x="${(cx - tw / 2).toFixed(2)}" y="${(cy - ch / 2).toFixed(2)}" width="${tw.toFixed(2)}" height="${ch}" rx="8" fill="${PLOT_COLORS.integralChipBg}"${opacity}/>`,
        );
        parts.push(
          `<text x="${cx.toFixed(2)}" y="${(cy + 4).toFixed(2)}" font-size="11" font-style="italic" font-family="serif" fill="${el.strokeColor}" text-anchor="middle"${opacity}>${escapeXml(chip)}</text>`,
        );
      } else {
        // 奇点 / 非法区间：顶部报错 chip（截断到绘图区宽，红字白底）
        const msg = `⚠ ${ig.error}`.slice(0, 44);
        const tw = Math.min(msg.length * 5.4 + 10, gw - 8);
        const lx = gx + (gw - tw) / 2;
        parts.push(
          `<rect x="${lx.toFixed(1)}" y="${(gy + 6).toFixed(1)}" width="${tw.toFixed(1)}" height="18" rx="6" fill="${PLOT_COLORS.integralChipBg}"${opacity}/>`,
        );
        parts.push(
          `<text x="${(gx + gw / 2).toFixed(1)}" y="${(gy + 18).toFixed(1)}" font-size="10" font-family="system-ui, sans-serif" fill="${PLOT_COLORS.integralErrorText}" text-anchor="middle" clip-path="url(#mpc-${el.id})"${opacity}>${escapeXml(msg)}</text>`,
        );
      }
    }

    // —— ZOO-192 T5 物理标注（与 drawGraphCore 同一套数据 / 配色 / 越界翻转口径）：
    //    导引虚线（峰值垂线 + 射程水平线）→ 峰值点 + H 标注 → 落地点 + R 标注 ——
    if (render.overlays?.physics) {
      const ph = render.overlays.physics;
      const guide = (x1: number, y1: number, x2: number, y2: number) =>
        `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${PLOT_COLORS.overlayPhysics}" stroke-width="1" stroke-dasharray="${PHYSICS_GUIDE_DASH.join(',')}" clip-path="url(#mpc-${el.id})"${opacity}/>`;
      parts.push(guide(toX(ph.peak.x), toY(ph.peak.y), toX(ph.peak.x), toY(ph.launch.y)));
      if (ph.landing) {
        parts.push(guide(toX(ph.launch.x), toY(ph.launch.y), toX(ph.landing.x), toY(ph.landing.y)));
      }
      const mark = (mx: number, my: number) =>
        `<circle cx="${mx.toFixed(2)}" cy="${my.toFixed(2)}" r="${PHYSICS_MARK_RADIUS_PX}" fill="${PLOT_COLORS.overlayPhysics}" stroke="#ffffff" stroke-width="1.5"${opacity}/>`;
      const markLabel = (text: string, px2: number, py2: number) =>
        `<text x="${px2.toFixed(2)}" y="${py2.toFixed(2)}" font-size="10" font-style="italic" font-family="system-ui, sans-serif" fill="${PLOT_COLORS.overlayPhysics}" text-anchor="start"${opacity}>${escapeXml(text)}</text>`;

      const peakPx = toX(ph.peak.x);
      const peakPy = toY(ph.peak.y);
      parts.push(mark(peakPx, peakPy));
      const hLabel = `H = ${formatOverlayNumber(ph.peak.height)}`;
      const hW = hLabel.length * 5.4;
      let hx = peakPx + 9;
      if (hx + hW > gx + gw - 3) hx = peakPx - 9 - hW;
      let hy = peakPy - 3;
      if (hy < gy + 10) hy = peakPy + 14;
      parts.push(markLabel(hLabel, hx, hy));

      if (ph.landing) {
        const landPx = toX(ph.landing.x);
        const landPy = toY(ph.landing.y);
        parts.push(mark(landPx, landPy));
        const rLabel = `R = ${formatOverlayNumber(ph.landing.range)}`;
        const rW = rLabel.length * 5.4;
        let rx = landPx - 9 - rW;
        if (rx < gx + 3) rx = landPx + 9;
        let ry = landPy - 3;
        if (ry < gy + 10) ry = landPy + 14;
        parts.push(markLabel(rLabel, rx, ry));
      }
    }

    // —— ZOO-215 圆锥曲线标注（与 drawGraphCore 同一套数据 / 配色 / 越界翻转
    //    口径）：准线 / 渐近线虚线 → 焦点点标记 + F₁/F₂/F 文字标签 ——
    if (render.overlays?.conic) {
      const cm = render.overlays.conic;
      const guides = cm.kind === 'parabola' && cm.directrix ? [cm.directrix] : cm.kind === 'hyperbola' && cm.asymptotes ? cm.asymptotes : [];
      for (const g of guides) {
        if (!g) continue;
        parts.push(
          `<line x1="${toX(g.a.x).toFixed(2)}" y1="${toY(g.a.y).toFixed(2)}" x2="${toX(g.b.x).toFixed(2)}" y2="${toY(g.b.y).toFixed(2)}" stroke="${PLOT_COLORS.overlayConic}" stroke-width="1" stroke-dasharray="${CONIC_GUIDE_DASH.join(',')}" clip-path="url(#mpc-${el.id})"${opacity}/>`,
        );
      }
      for (const f of cm.foci) {
        const px = toX(f.x);
        const py = toY(f.y);
        parts.push(
          `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${CONIC_MARK_RADIUS_PX}" fill="${PLOT_COLORS.overlayConic}" stroke="#ffffff" stroke-width="1.5"${opacity}/>`,
        );
        const labelW = f.label.length * 5.4;
        let lx = px + 9;
        if (lx + labelW > gx + gw - 3) lx = px - 9 - labelW;
        let ly = py - 3;
        if (ly < gy + 10) ly = py + 14;
        parts.push(
          `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-size="10" font-style="italic" font-family="system-ui, sans-serif" fill="${PLOT_COLORS.overlayConic}" text-anchor="start"${opacity}>${escapeXml(f.label)}</text>`,
        );
      }
    }

    // —— ZOO-199 持久化 POI 标注（与 drawGraphCore 同一套数据 / 配色 / 越界
    //    翻转口径）：灰底白边圆点 + 坐标文本；点收拢回绘图区内缘（快照标注
    //    恒可见），标注随元素持久化——导出结果与画布所见一致 ——
    if (el.kind === 'explicit' && !el.error && el.poiAnnotations && el.poiAnnotations.length > 0) {
      for (const a of el.poiAnnotations) {
        const px = Math.min(Math.max(toX(a.x), gx + 4), gx + gw - 4);
        const py = Math.min(Math.max(toY(a.y), gy + 4), gy + gh - 4);
        parts.push(
          `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="4" fill="${PLOT_COLORS.poiDot}" stroke="#ffffff" stroke-width="1.5"${opacity}/>`,
        );
        const label = formatPoiCoord(a.x, a.y);
        const labelW = label.length * 5.4;
        let lx = px + 9;
        if (lx + labelW > gx + gw - 3) lx = px - 9 - labelW;
        let ly = py - 3;
        if (ly < gy + 10) ly = py + 14;
        parts.push(
          `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-size="10" font-style="italic" font-family="system-ui, sans-serif" fill="${PLOT_COLORS.poiText}" text-anchor="start"${opacity}>${escapeXml(label)}</text>`,
        );
      }
    }

    // —— ZOO-201 可拖点（与 drawGraphCore 同一套数据 / 配色）：蓝底白边圆点，
    //    沿曲线点加浅蓝外圈；不 clamp（越出视窗随 clip 不可见，画布 / 导出同口径） ——
    if (el.kind === 'explicit' && !el.error && el.draggablePoints && el.draggablePoints.length > 0) {
      for (const p of resolveDragPoints(el)) {
        const px = toX(p.x);
        const py = toY(p.y);
        if (p.mode === 'onCurve') {
          parts.push(
            `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="7.5" fill="none" stroke="${PLOT_COLORS.dragPointRing}" stroke-width="1.5" clip-path="url(#mpc-${el.id})"${opacity}/>`,
          );
        }
        parts.push(
          `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="4" fill="${PLOT_COLORS.dragPoint}" stroke="#ffffff" stroke-width="1.5" clip-path="url(#mpc-${el.id})"${opacity}/>`,
        );
      }
    }
  }

  if (el.showLabel) {
    const text = beautifyEquation(el.equation);
    const cw = text.length * 6.6 + 14;
    parts.push(`<rect x="${x + 6}" y="${y + h - 22}" width="${cw.toFixed(0)}" height="18" rx="9" fill="rgba(59,130,246,0.08)"/>`);
    parts.push(`<text x="${x + 13}" y="${y + h - 9}" font-size="11" font-family="serif" fill="#3B82F6">${escapeXml(text)}</text>`);
    // 双色图例 chip（ZOO-189）：f 实线（元素色）/ f′ 虚线橙，仅 f′ 叠加时出现
    if (render.overlays?.derivative) {
      const sw = 14;
      const gap = 8;
      const lw = 7 + sw + 3 + 5 + gap + sw + 3 + 10 + 5;
      const lx = x + 6 + cw + 6;
      const midY = y + h - 13;
      const swLine = Math.min(Math.max(el.strokeWidth, 1.5), 3);
      parts.push(`<rect x="${lx.toFixed(1)}" y="${y + h - 22}" width="${lw.toFixed(0)}" height="18" rx="9" fill="rgba(59,130,246,0.08)"/>`);
      let cx0 = lx + 7;
      parts.push(`<line x1="${cx0.toFixed(1)}" y1="${midY.toFixed(1)}" x2="${(cx0 + sw).toFixed(1)}" y2="${midY.toFixed(1)}" stroke="${el.strokeColor}" stroke-width="${swLine}"/>`);
      parts.push(`<text x="${(cx0 + sw + 3).toFixed(1)}" y="${(midY + 4).toFixed(1)}" font-size="11" font-style="italic" font-family="serif" fill="${el.strokeColor}">f</text>`);
      cx0 += sw + 3 + 5 + gap;
      parts.push(`<line x1="${cx0.toFixed(1)}" y1="${midY.toFixed(1)}" x2="${(cx0 + sw).toFixed(1)}" y2="${midY.toFixed(1)}" stroke="${PLOT_COLORS.overlayDerivative}" stroke-width="${swLine}" stroke-dasharray="${OVERLAY_DERIVATIVE_DASH.join(',')}"/>`);
      parts.push(`<text x="${(cx0 + sw + 3).toFixed(1)}" y="${(midY + 4).toFixed(1)}" font-size="11" font-style="italic" font-family="serif" fill="${PLOT_COLORS.overlayDerivative}">f′</text>`);
    }
  }

  return parts.join('');
}

/**
 * 绘制序统一：帧是底图层（ZOO-198），无论 elements 数组序如何，导出时帧先画、
 * 内容后画——帧白底不遮内容，与 Canvas 渲染的分区语义一致。无帧时退化为原序。
 */
function framesFirst(elements: WhiteboardElement[]): WhiteboardElement[] {
  if (!elements.some(isFrame)) return elements;
  return [...elements.filter(isFrame), ...elements.filter((e) => !isFrame(e))];
}

/** ZOO-176：t 为文案翻译器（错误占位提示随语言），缺省中文。 */
export function exportToSvg(elements: WhiteboardElement[], t: LibT = zhT, options?: Partial<ExportOptions>): string {
  const opts = { ...DEFAULT_OPTIONS, ...options, format: 'svg' as const };
  const bounds = getAllElementsBounds(elements);
  const pad = opts.padding;

  let vbX = 0, vbY = 0, vbW = 800, vbH = 600;
  if (bounds) {
    vbX = bounds.x - pad;
    vbY = bounds.y - pad;
    vbW = bounds.width + pad * 2;
    vbH = bounds.height + pad * 2;
  }

  const bg = opts.background === 'transparent'
    ? ''
    : `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${opts.background}"/>`;

  const els = framesFirst(elements).map((el) => elementToSvg(el, t)).join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}">
  ${bg}
  ${els}
</svg>`;
}

/**
 * 导出当前页 SVG（ZOO-198）：viewBox = 帧边界 + 上缘标题条（padding 缺省 0——
 * 按帧精确裁剪），内容 clip 到帧矩形，页外元素不出现；帧底图与页名随页导出。
 */
export function exportFrameToSvg(
  frame: FrameElement,
  elements: WhiteboardElement[],
  t: LibT = zhT,
  options?: Partial<ExportOptions>
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options, format: 'svg' as const, padding: options?.padding ?? 0 };
  const region = frameExportRegion(frame);
  const contents = frameContents(elements, frame);
  const vbX = region.x - opts.padding;
  const vbY = region.y - opts.padding;
  const vbW = region.width + opts.padding * 2;
  const vbH = region.height + opts.padding * 2;

  const bg = opts.background === 'transparent'
    ? ''
    : `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${opts.background}"/>`;
  const clipId = `frame-clip-${frame.id}`;
  const body = contents.map((el) => elementToSvg(el, t)).join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}">
  ${bg}
  <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
  <defs><clipPath id="${clipId}"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"/></clipPath></defs>
  <g clip-path="url(#${clipId})">
    ${body}
  </g>
  <text x="${frame.x}" y="${frame.y - 10}" font-size="13" font-weight="600" font-family="system-ui, sans-serif" fill="#64748b">${escapeXml(frame.name)}</text>
</svg>`;
}

/**
 * 导出当前页 PNG/JPG（ZOO-198）：canvas 尺寸 = 帧边界 + 标题条（× scale），
 * 内容 ctx.clip 到帧矩形；帧底图先画、内容后画（同 Canvas 分区语义）。
 */
export async function exportFrameToImage(
  frame: FrameElement,
  elements: WhiteboardElement[],
  format: 'png' | 'jpg',
  options?: Partial<ExportOptions>,
  t: LibT = zhT
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options, format, padding: options?.padding ?? 0 };
  const region = frameExportRegion(frame);
  const contents = frameContents(elements, frame);
  const scale = opts.scale;
  const cw = region.width + opts.padding * 2;
  const ch = region.height + opts.padding * 2;

  const canvas = document.createElement('canvas');
  canvas.width = cw * scale;
  canvas.height = ch * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  if (opts.background !== 'transparent') {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, cw, ch);
  }

  const viewport = { offsetX: -(region.x - opts.padding), offsetY: -(region.y - opts.padding), scale: 1 };
  drawFrame(ctx, frame, viewport); // 白底 + 页框 + 页名（标题条内，不受裁剪影响）
  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.x + viewport.offsetX, frame.y + viewport.offsetY, frame.width, frame.height);
  ctx.clip();
  for (const el of contents) {
    renderElement(ctx, el, viewport, t);
  }
  ctx.restore();

  return new Promise((resolve, reject) => {
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const quality = format === 'jpg' ? 0.92 : undefined;
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create image blob'));
      },
      mimeType,
      quality
    );
  });
}

export async function exportToImage(
  elements: WhiteboardElement[],
  format: 'png' | 'jpg',
  options?: Partial<ExportOptions>,
  t: LibT = zhT
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options, format };
  const bounds = getAllElementsBounds(elements);
  const pad = opts.padding;
  const scale = opts.scale;

  let cw = 800, ch = 600;
  let ox = 0, oy = 0;
  if (bounds) {
    ox = bounds.x - pad;
    oy = bounds.y - pad;
    cw = bounds.width + pad * 2;
    ch = bounds.height + pad * 2;
  }

  const canvas = document.createElement('canvas');
  canvas.width = cw * scale;
  canvas.height = ch * scale;
  const ctx = canvas.getContext('2d')!;

  ctx.scale(scale, scale);

  if (opts.background !== 'transparent') {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, cw, ch);
  }

  const viewport = { offsetX: -ox, offsetY: -oy, scale: 1 };
  for (const el of framesFirst(elements)) {
    renderElement(ctx, el, viewport, t);
  }

  return new Promise((resolve, reject) => {
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const quality = format === 'jpg' ? 0.92 : undefined;
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create image blob'));
      },
      mimeType,
      quality
    );
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadText(content: string, filename: string, mimeType: string = 'image/svg+xml') {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}
