import { WhiteboardElement, PathElement, RectangleElement, CircleElement, LineElement, ArrowElement, TextElement, MathPlotElement } from './types';
import { renderElement, getAllElementsBounds } from './renderer';
import { zhT, type LibT } from '../i18n/lib';
import { resolvePlotRender, stepForAxis, formatTickLabel, MIN_GRID_PX, MIN_TICK_LABEL_PX } from './math/plot';
import { plotTokenFor } from './math/cache';
import { beautifyEquation } from './math/label';
import { dashPatternFor } from './stroke';
import { lineVertices, isPolyline } from './polyline';

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

  const render = resolvePlotRender(
    {
      equation: el.equation,
      kind: el.kind,
      errorMessage: el.error ?? undefined,
      xAxis: el.xAxis,
      equalRatio: el.equalRatio,
      sampleCount: el.sampleCount,
    },
    { width: w, height: h },
    plotTokenFor(el.id)
  );

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

  if (render.polylines.length > 0) {
    let d = '';
    for (const pl of render.polylines) {
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
    if (d) {
      // 曲线裁剪到内嵌绘图区（ZOO-147）：几何 kind 采样刻意越出卡片（贯穿边缘），
      // canvas 有 ctx.clip 而 SVG 需显式 clipPath，否则导出的直线/双曲线溢出卡片
      parts.push(`<defs><clipPath id="mpc-${el.id}"><rect x="${gx}" y="${gy}" width="${gw}" height="${gh}"/></clipPath></defs>`);
      parts.push(`<path d="${d.trim()}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#mpc-${el.id})"${opacity}/>`);
    }
  }

  if (el.showLabel) {
    const text = beautifyEquation(el.equation);
    const cw = text.length * 6.6 + 14;
    parts.push(`<rect x="${x + 6}" y="${y + h - 22}" width="${cw.toFixed(0)}" height="18" rx="9" fill="rgba(59,130,246,0.08)"/>`);
    parts.push(`<text x="${x + 13}" y="${y + h - 9}" font-size="11" font-family="serif" fill="#3B82F6">${escapeXml(text)}</text>`);
  }

  return parts.join('');
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

  const els = elements.map((el) => elementToSvg(el, t)).join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}">
  ${bg}
  ${els}
</svg>`;
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
  for (const el of elements) {
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
