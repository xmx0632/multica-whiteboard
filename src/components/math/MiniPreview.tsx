'use client';

/**
 * 方程编辑器实时小预览（240×96，交互原型基线）。
 *
 * 纯渲染组件：只消费采样折线（数学坐标），与主画布共用同一套数据
 * （技术方案 D3「采样与渲染目标解耦」）。折线由外部注入 —— 4b/4c 采样管线
 * 接入后传入；当前未接入时显示空坐标系，错误时显示原因文案。
 */
import { useEffect, useRef } from 'react';
import type { Polyline } from '@/lib/math/types';

export interface MiniPreviewProps {
  /** wait=等待输入（居中“实时预览”）；ok=已识别；error=校验失败 */
  status: 'wait' | 'ok' | 'error';
  /** status=error 时的原因文案 */
  errorMessage?: string;
  /** 采样折线（数学坐标，数学 y 向上）；status=ok 且非空时绘制曲线 */
  polylines?: Polyline[] | null;
  /** x 数学视窗，默认 [-10, 10]；y 视窗按折线数据自适应 */
  xMin?: number;
  xMax?: number;
  /** y 数学视窗（采样管线给出的稳健视窗）；缺省时按折线数据自适应 */
  yMin?: number;
  yMax?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

const W = 240;
const H = 96;
const GRID_COLOR = '#e5e7eb';
const AXIS_COLOR = '#9ca3af';
const MIN_GRID_PX = 8;

/** “好看刻度”步长（原型 niceStep 平移）：range/target 后取 1/2/2.5/5×10^k。 */
function niceStep(range: number, target: number): number {
  const raw = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * pow + 1e-12) return m * pow;
  }
  return 10 * pow;
}

/** 由折线数据推导 y 视窗：有限值 min/max + 8% 留白；退化（水平线）扩 ±1。 */
function fitY(polylines: Polyline[], fallbackSpan: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const pl of polylines) {
    for (const p of pl) {
      if (Number.isFinite(p.y)) {
        if (p.y < min) min = p.y;
        if (p.y > max) max = p.y;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: -fallbackSpan / 2, max: fallbackSpan / 2 };
  }
  if (max - min < 1e-9) {
    const mid = (max + min) / 2;
    return { min: mid - 1, max: mid + 1 };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

export default function MiniPreview({
  status,
  errorMessage,
  polylines,
  xMin = -10,
  xMax = 10,
  yMin,
  yMax,
  strokeColor = '#3B82F6',
  strokeWidth = 2,
}: MiniPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 等待输入：占位文案
    if (status === 'wait') {
      ctx.fillStyle = '#d1d5db';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('实时预览', W / 2, H / 2);
      return;
    }

    // 错误：原因文案（多行折行）
    if (status === 'error') {
      ctx.fillStyle = '#ef4444';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const msg = errorMessage || '无法预览';
      const maxWidth = W - 24;
      const lines: string[] = [];
      let line = '';
      for (const ch of msg) {
        if (ctx.measureText(line + ch).width > maxWidth) {
          lines.push(line);
          line = ch;
        } else {
          line += ch;
        }
      }
      if (line) lines.push(line);
      const shown = lines.slice(0, 3);
      shown.forEach((l, idx) => ctx.fillText(l, W / 2, H / 2 + (idx - (shown.length - 1) / 2) * 13));
      return;
    }

    // 已识别：轻网格 + 坐标轴（+ 折线，如已接入采样）
    const yWin =
      yMin !== undefined && yMax !== undefined && yMax > yMin ? { min: yMin, max: yMax } : fitY(polylines || [], ((xMax - xMin) * H) / W);
    const toPxX = (mx: number) => ((mx - xMin) / (xMax - xMin)) * W;
    const toPxY = (my: number) => H - ((my - yWin.min) / (yWin.max - yWin.min)) * H;

    const stepX = niceStep(xMax - xMin, W / MIN_GRID_PX);
    if ((stepX / (xMax - xMin)) * W >= MIN_GRID_PX) {
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let v = Math.ceil(xMin / stepX) * stepX; v <= xMax + 1e-9; v += stepX) {
        const px = Math.round(toPxX(v)) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, H);
      }
      ctx.stroke();
    }
    const stepY = niceStep(yWin.max - yWin.min, H / MIN_GRID_PX);
    if ((stepY / (yWin.max - yWin.min)) * H >= MIN_GRID_PX) {
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let v = Math.ceil(yWin.min / stepY) * stepY; v <= yWin.max + 1e-9; v += stepY) {
        const py = Math.round(toPxY(v)) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(W, py);
      }
      ctx.stroke();
    }

    // 过原点的十字轴（视窗内时）
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (xMin <= 0 && xMax >= 0) {
      const px = Math.round(toPxX(0)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
    }
    if (yWin.min <= 0 && yWin.max >= 0) {
      const py = Math.round(toPxY(0)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(W, py);
    }
    ctx.stroke();

    // 曲线（采样折线，折线间断笔）
    if (polylines && polylines.length > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const pl of polylines) {
        let drawing = false;
        for (const p of pl) {
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
            drawing = false;
            continue;
          }
          const px = toPxX(p.x);
          const py = toPxY(p.y);
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
  }, [status, errorMessage, polylines, xMin, xMax, yMin, yMax, strokeColor, strokeWidth]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: H, display: 'block' }}
      className="bg-white border border-[#eef0f3] rounded-lg"
      aria-label="方程实时预览"
    />
  );
}
