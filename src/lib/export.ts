import { WhiteboardElement, PathElement, RectangleElement, CircleElement, LineElement, ArrowElement, TextElement } from './types';
import { renderElement, getAllElementsBounds } from './renderer';

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

function elementToSvg(el: WhiteboardElement): string {
  const opacity = el.opacity < 1 ? ` opacity="${el.opacity}"` : '';

  switch (el.type) {
    case 'path':
      return `<path d="${pathToSvgPath(el)}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`;
    case 'rectangle':
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}"${el.fillColor ? ` fill="${el.fillColor}"` : ' fill="none"'}${opacity}/>`;
    case 'circle': {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const rx = el.width / 2;
      const ry = el.height / 2;
      return `<ellipse cx="${cx}" cy="${cy}" rx="${Math.abs(rx)}" ry="${Math.abs(ry)}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}"${el.fillColor ? ` fill="${el.fillColor}"` : ' fill="none"'}${opacity}/>`;
    }
    case 'line':
      return `<line x1="${el.x}" y1="${el.y}" x2="${el.x2}" y2="${el.y2}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" stroke-linecap="round"${opacity}/>`;
    case 'arrow': {
      const headLen = Math.max(10, el.strokeWidth * 4);
      const angle = Math.atan2(el.y2 - el.y, el.x2 - el.x);
      const ax1 = el.x2 - headLen * Math.cos(angle - Math.PI / 6);
      const ay1 = el.y2 - headLen * Math.sin(angle - Math.PI / 6);
      const ax2 = el.x2 - headLen * Math.cos(angle + Math.PI / 6);
      const ay2 = el.y2 - headLen * Math.sin(angle + Math.PI / 6);
      return `<line x1="${el.x}" y1="${el.y}" x2="${el.x2}" y2="${el.y2}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" stroke-linecap="round"${opacity}/>` +
        `<polygon points="${el.x2},${el.y2} ${ax1},${ay1} ${ax2},${ay2}" fill="${el.strokeColor}"${opacity}/>`;
    }
    case 'text': {
      const lines = el.content.split('\n');
      const lineHeight = el.fontSize * 1.3;
      const tspans = lines.map((line, i) =>
        `<tspan x="${el.x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
      ).join('');
      return `<text x="${el.x}" y="${el.y}" font-size="${el.fontSize}" font-family="${el.fontFamily || 'sans-serif'}" fill="${el.color}"${opacity}>${tspans}</text>`;
    }
    default:
      return '';
  }
}

export function exportToSvg(elements: WhiteboardElement[], options?: Partial<ExportOptions>): string {
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

  const els = elements.map(elementToSvg).join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}">
  ${bg}
  ${els}
</svg>`;
}

export async function exportToImage(
  elements: WhiteboardElement[],
  format: 'png' | 'jpg',
  options?: Partial<ExportOptions>
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
    renderElement(ctx, el, viewport);
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
