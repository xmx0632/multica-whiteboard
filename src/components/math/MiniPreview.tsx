'use client';

/**
 * 方程编辑器实时小预览（240×96，交互原型基线）。
 *
 * 纯渲染组件：只消费采样折线（数学坐标）。图核心（网格/十字轴/曲线）自
 * ZOO-135 起委托 plot.ts drawGraphCore —— 与主画布 MathPlot 卡片同一套绘制
 * 函数（技术方案 D3「预览即真实渲染结果」），仅网格密度参数不同（8px vs 45px）。
 */
import { useEffect, useRef } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { drawGraphCore, MIN_GRID_PX } from '@/lib/math/plot';
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
  const t = useT();

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
      ctx.fillText(t('equation.previewWait'), W / 2, H / 2);
      return;
    }

    // 错误：原因文案（多行折行）
    if (status === 'error') {
      ctx.fillStyle = '#ef4444';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const msg = errorMessage || t('equation.previewUnavailable');
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

    // 已识别：图核心（轻网格 + 十字轴 + 采样折线），与主画布共用 drawGraphCore
    const yWin =
      yMin !== undefined && yMax !== undefined && yMax > yMin ? { min: yMin, max: yMax } : fitY(polylines || [], ((xMax - xMin) * H) / W);
    drawGraphCore(ctx, {
      width: W,
      height: H,
      view: { xMin, xMax, yMin: yWin.min, yMax: yWin.max },
      polylines: polylines || [],
      path2d: null,
      style: { strokeColor, strokeWidth, opacity: 1 },
      showGrid: true,
      showAxis: true,
      tickLabels: false,
      gridTargetPx: MIN_GRID_PX,
    });
  }, [status, errorMessage, polylines, xMin, xMax, yMin, yMax, strokeColor, strokeWidth, t]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: H, display: 'block' }}
      className="bg-white border border-[#eef0f3] rounded-lg"
      aria-label={t('equation.previewAria')}
    />
  );
}
