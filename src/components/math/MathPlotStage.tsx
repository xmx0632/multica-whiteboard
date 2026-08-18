'use client';

/**
 * MathPlot 出图舞台（ZOO-135 / 4c 交付的「选中方程 → 自动出图」演示与集成参照）。
 *
 * 串起 4a/4b/4c 全链路：EquationEditor（输入/校验）→ parse/sample（解析采样）
 * → plot.ts drawMathPlot（矢量渲染）。演示交互基线：
 * - 方程列表点选 → 自动出图（选中卡片高亮 + 参数面板实时调样式/定义域/采样档）；
 * - 多图形共存（2 列卡片流）、错误占位卡 + 原位重编辑（原型决策 4）；
 * - 画布拖拽平移 / 滚轮缩放 —— 全程命中 Path2D 缓存，不触发重采样（§6.4）。
 *
 * ZOO-136（4d）集成时：renderElement case 'mathPlot' 按 drawCard 同构接入
 * （translate/scale → drawMathPlot），本组件即视觉与行为基线。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import EquationEditor from './EquationEditor';
import MathPlotParams, { type MathPlotParamsValue } from './MathPlotParams';
import { beautifyEquation } from '@/lib/math/label';
import { parseEquation } from '@/lib/math/parse';
import { drawMathPlot, resolvePlotRender, type PlotFrame, type PlotSpec } from '@/lib/math/plot';
import { sampleGeometry } from '@/lib/math/sample';
import type { EquationDraftPayload } from '@/lib/math/types';
import type { Viewport } from '@/lib/types';
import { renderGrid } from '@/lib/renderer';

/** 卡片布局（世界 px）：2 列卡片流。 */
const CARD_WIDTH = 360;
const CARD_HEIGHT = 270;
const CARD_GAP = 40;
const MARGIN = 40;
const COLUMNS = 2;

interface PlotItem extends MathPlotParamsValue {
  id: string;
}

interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
  itemId: string;
}

/** 由编辑器确认载荷生成条目（错误态同样建卡，原型决策 4）。 */
function itemFromPayload(payload: EquationDraftPayload, prev?: PlotItem): PlotItem {
  const outcome = payload.outcome;
  const isGeo = outcome.kind === 'circle' || outcome.kind === 'ellipse';
  const geoFields = isGeo ? geometryFields(outcome) : {};
  return {
    id: prev?.id ?? uuidv4(),
    xAxis: prev?.xAxis ?? { min: -10, max: 10 },
    sampleCount: prev?.sampleCount ?? 320,
    equalRatio: isGeo,
    showAxis: prev?.showAxis ?? true,
    showGrid: prev?.showGrid ?? true,
    showLabel: prev?.showLabel ?? true,
    strokeColor: prev?.strokeColor ?? '#3B82F6',
    strokeWidth: prev?.strokeWidth ?? 2,
    opacity: prev?.opacity ?? 1,
    equation: payload.equation,
    kind: outcome.kind,
    errorMessage: outcome.kind === 'error' ? outcome.message : undefined,
    ...geoFields,
  };
}

/** 几何方程附加字段：定义域取采样包围盒（供等比卡片取纵横比）。 */
function geometryFields(
  outcome: { kind: 'circle'; params: { cx: number; cy: number; r: number } } | { kind: 'ellipse'; params: { cx: number; cy: number; rx: number; ry: number } }
): Partial<PlotItem> {
  const bbox = sampleGeometry(outcome.kind, outcome.params);
  if ('error' in bbox) return { equalRatio: true };
  return { xAxis: { min: bbox.xMin ?? -10, max: bbox.xMax ?? 10 }, equalRatio: true };
}

/** 卡片外框：显式函数固定 360×270；几何按包围盒纵横比等比（clamp 150–450）。 */
function frameOf(item: PlotItem): PlotFrame {
  if (item.kind !== 'circle' && item.kind !== 'ellipse') {
    return { width: CARD_WIDTH, height: CARD_HEIGHT };
  }
  const height = Math.min(Math.max(CARD_WIDTH * geometryAspect(item.equation), 150), 450);
  return { width: CARD_WIDTH, height };
}

/** 几何方程包围盒 高/宽 比（解析失败回落 3/4 卡片）。 */
function geometryAspect(equation: string): number {
  const parsed = parseEquation(equation);
  if (parsed.kind !== 'circle' && parsed.kind !== 'ellipse') return 0.75;
  const bbox = sampleGeometry(parsed.kind, parsed.params);
  if ('error' in bbox) return 0.75;
  const w = bbox.xMax ?? 1;
  const h = bbox.yMax - bbox.yMin;
  return w > 0 ? h / w : 0.75;
}

function specOf(item: PlotItem): PlotSpec {
  return {
    equation: item.equation,
    kind: item.kind,
    errorMessage: item.errorMessage,
    xAxis: item.xAxis,
    equalRatio: item.equalRatio,
    sampleCount: item.sampleCount,
  };
}

export default function MathPlotStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRectsRef = useRef<CardRect[]>([]);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [stageViewport, setStageViewport] = useState<Viewport>({ offsetX: 0, offsetY: 0, scale: 1 });
  const [items, setItems] = useState<PlotItem[]>(() => [
    itemFromPayload({ equation: 'y=sin(x)', outcome: { kind: 'explicit' } }),
    itemFromPayload({ equation: '(x-1)²+(y-2)²=9', outcome: { kind: 'circle', params: { cx: 1, cy: 2, r: 3 } } }),
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorSeed, setEditorSeed] = useState<{ id: string; equation: string } | null>(null);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  // —— 尺寸自适应 ——
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // —— 绘制（items/选中/视口任一变化全量重绘；采样与 Path2D 走 WeakMap 缓存）——
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    // 白板同款点阵背景
    renderGrid(ctx, size.width, size.height, stageViewport);

    const rects: CardRect[] = [];
    let rowY = MARGIN;
    let rowH = 0;
    items.forEach((item, i) => {
      if (i > 0 && i % COLUMNS === 0) {
        rowY += rowH + CARD_GAP;
        rowH = 0;
      }
      const frame = frameOf(item);
      const x = MARGIN + (i % COLUMNS) * (CARD_WIDTH + CARD_GAP);
      const y = rowY;
      rowH = Math.max(rowH, frame.height);
      rects.push({ x, y, width: frame.width, height: frame.height, itemId: item.id });

      const render = resolvePlotRender(specOf(item), frame, item);
      ctx.save();
      ctx.translate(x * stageViewport.scale + stageViewport.offsetX, y * stageViewport.scale + stageViewport.offsetY);
      ctx.scale(stageViewport.scale, stageViewport.scale);
      drawMathPlot(ctx, {
        x: 0,
        y: 0,
        width: frame.width,
        height: frame.height,
        render,
        style: { strokeColor: item.strokeColor, strokeWidth: item.strokeWidth, opacity: item.opacity },
        showAxis: item.showAxis,
        showGrid: item.showGrid,
        showLabel: item.showLabel,
        equation: item.equation,
      });
      if (item.id === selectedId) {
        // 选中态：同款蓝色虚线框 + 角点手柄（参照 renderSelection）
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(-4, -4, frame.width + 8, frame.height + 8);
        ctx.setLineDash([]);
        ctx.fillStyle = '#3B82F6';
        const hs = 8;
        for (const [hx, hy] of [
          [-4, -4],
          [frame.width + 4 - hs, -4],
          [-4, frame.height + 4 - hs],
          [frame.width + 4 - hs, frame.height + 4 - hs],
        ]) {
          ctx.fillRect(hx, hy, hs, hs);
        }
      }
      ctx.restore();
    });
    cardRectsRef.current = rects;
  }, [items, selectedId, stageViewport, size]);

  // —— 画布交互：拖拽平移 / 滚轮缩放 / 点击卡片选中 ——
  const dragStateRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        offsetX: stageViewport.offsetX,
        offsetY: stageViewport.offsetY,
        moved: false,
      };
    },
    [stageViewport]
  );

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const st = dragStateRef.current;
    if (!st) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
    if (st.moved) {
      setStageViewport((v) => ({ ...v, offsetX: st.offsetX + dx, offsetY: st.offsetY + dy }));
    }
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const st = dragStateRef.current;
      dragStateRef.current = null;
      if (!st || st.moved) return;
      // 点击（非拖拽）：命中卡片 → 选中出图；空白 → 取消选中回到编辑器
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wx = (sx - stageViewport.offsetX) / stageViewport.scale;
      const wy = (sy - stageViewport.offsetY) / stageViewport.scale;
      const hit = cardRectsRef.current.find((c) => wx >= c.x && wx <= c.x + c.width && wy >= c.y && wy <= c.y + c.height);
      if (hit) {
        setSelectedId(hit.itemId);
        setEditorSeed(null);
      } else {
        setSelectedId(null);
      }
    },
    [stageViewport]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setStageViewport((v) => {
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const scale = Math.max(0.2, Math.min(4, v.scale * factor));
        return {
          scale,
          offsetX: mx - (mx - v.offsetX) * (scale / v.scale),
          offsetY: my - (my - v.offsetY) * (scale / v.scale),
        };
      });
    },
    []
  );

  // —— 编辑器确认：新建出图（自动选中），或原位替换（重编辑流程）——
  const handleConfirm = useCallback(
    (payload: EquationDraftPayload) => {
      if (editorSeed) {
        const seedId = editorSeed.id;
        setItems((prev) => {
          const target = prev.find((i) => i.id === seedId);
          if (!target) return [...prev, itemFromPayload(payload)];
          return prev.map((i) => (i.id === seedId ? itemFromPayload(payload, target) : i));
        });
        setSelectedId(seedId);
      } else {
        const item = itemFromPayload(payload);
        setItems((prev) => [...prev, item]);
        setSelectedId(item.id);
      }
      setEditorSeed(null);
    },
    [editorSeed]
  );

  // —— 参数面板：patch 实时重绘（改方程输入不翻面板模式，blur 时经 onCommit 收敛）——
  const handleParamsChange = useCallback(
    (patch: Partial<MathPlotParamsValue>) => {
      if (!selectedId) return;
      setItems((prev) => prev.map((i) => (i.id === selectedId ? { ...i, ...patch } : i)));
    },
    [selectedId]
  );

  const handleParamsCommit = useCallback(() => {
    if (!selectedId) return;
    // 方程文本收敛：重新校验并回写分类/错误信息（面板模式据此切换）
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== selectedId) return i;
        const outcome = validateForItem(i.equation);
        return { ...i, kind: outcome.kind, errorMessage: outcome.errorMessage };
      })
    );
  }, [selectedId]);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    setItems((prev) => prev.filter((i) => i.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  return (
    <div ref={containerRef} className="w-screen h-screen overflow-hidden relative bg-gray-50">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* 顶部说明条 */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-white/90 backdrop-blur-sm rounded-full shadow border border-gray-200 text-xs text-gray-500 select-none">
        选中方程 → 自动出图 ｜ 拖拽平移 · 滚轮缩放 · 点击卡片选中/取消
      </div>

      {/* 左侧方程列表：点选即出图 */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 w-[232px] bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-2">
        <div className="text-[13px] font-semibold text-gray-700 flex items-center gap-1.5">
          <span className="font-serif italic text-blue-500 text-base leading-none">ƒ</span>
          方程列表
          <span className="ml-auto text-[10px] text-gray-400 font-normal">{items.length} 个图形</span>
        </div>
        <div className="flex flex-col gap-1 max-h-[46vh] overflow-y-auto">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSelectedId(item.id);
                setEditorSeed(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 border rounded-lg text-left cursor-pointer transition-colors ${
                item.id === selectedId ? 'border-blue-500 bg-blue-50/60' : 'border-gray-200 bg-white hover:border-blue-400'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.strokeColor }} />
              <span className="font-serif text-xs text-gray-800 whitespace-nowrap overflow-hidden text-ellipsis">
                {beautifyEquation(item.equation)}
              </span>
            </button>
          ))}
          {items.length === 0 && <div className="text-[11px] text-gray-400 py-2 text-center">暂无方程，从右侧编辑器添加</div>}
        </div>
        <button
          type="button"
          onClick={() => {
            setSelectedId(null);
            setEditorSeed(null);
          }}
          className="py-1.5 border border-dashed border-gray-300 rounded-lg bg-white text-gray-500 text-xs cursor-pointer hover:border-blue-500 hover:text-blue-500 transition-colors"
        >
          ＋ 新建方程
        </button>
        <div className="text-[10px] text-gray-400 leading-relaxed">平移/缩放不触发重采样（Path2D 缓存命中）。</div>
      </div>

      {/* 右侧面板：无选中 = 编辑器（新建/重编辑）；有选中 = 参数面板（实时调样式） */}
      {selected ? (
        <MathPlotParams
          value={selected}
          onChange={handleParamsChange}
          onCommit={handleParamsCommit}
          onDelete={handleDelete}
          onRequestEdit={() => {
            setEditorSeed({ id: selected.id, equation: selected.equation });
            setSelectedId(null);
          }}
        />
      ) : (
        <EquationEditor key={editorSeed?.id ?? 'new'} initialEquation={editorSeed?.equation ?? ''} onConfirm={handleConfirm} />
      )}
    </div>
  );
}

/** 条目方程的重新校验（kind/errorMessage 收敛，避免引入编辑器内部状态）。 */
function validateForItem(equation: string): { kind: PlotItem['kind']; errorMessage?: string } {
  const r = parseEquation(equation);
  return r.kind === 'error' ? { kind: 'error', errorMessage: r.message } : { kind: r.kind };
}
