'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '@/lib/store';
import { renderGrid, renderElements, renderSelection, hitTest, screenToCanvas, hitTestSelectionHandle, MathPlotHandle } from '@/lib/renderer';
import { WhiteboardElement, PathElement, Point, MathPlotElement, MATHPLOT_MIN_WIDTH, MATHPLOT_MIN_HEIGHT } from '@/lib/types';
import { createMathPlotElement } from '@/lib/mathplotElement';
import { v4 as uuidv4 } from 'uuid';

export default function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const isDrawingRef = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const tempElementRef = useRef<WhiteboardElement | null>(null);
  const dragStartRef = useRef<Point>({ x: 0, y: 0 });
  const dragElementStartRef = useRef<Point>({ x: 0, y: 0 });
  const panStartRef = useRef<Point>({ x: 0, y: 0 });
  const panOffsetStartRef = useRef<Point>({ x: 0, y: 0 });
  // pan 的 rAF 合并（技术方案 §6.4）：mousemove 只记最新位移，每帧至多一次 setViewport
  const panRafRef = useRef<number | null>(null);
  const panPendingRef = useRef<Point | null>(null);
  // mathPlot 8 控点缩放（§11 D-1）：startEl 为手势前快照，mouseUp 压一条 update 快照
  const resizeRef = useRef<{ handle: MathPlotHandle; startEl: MathPlotElement; startWorld: Point } | null>(null);

  const {
    elements, selectedId, activeTool, strokeColor, strokeWidth, fillColor, fontSize,
    viewport, addElement, updateElement, setSelected, setViewport, pushOperations,
    pendingMathPlot, consumeMathPlotInsert, setTool,
  } = useStore();

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    renderGrid(ctx, rect.width, rect.height, viewport);
    // 传入可视尺寸启用视口 culling（§6.4，视口外元素跳过绘制）
    renderElements(ctx, elements, viewport, { width: rect.width, height: rect.height });
    if (tempElementRef.current) {
      renderElements(ctx, [tempElementRef.current], viewport);
    }
    const sel = elements.find((e) => e.id === selectedId);
    if (sel) {
      renderSelection(ctx, sel, viewport);
    }
  }, [elements, selectedId, viewport]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const handleResize = () => render();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [render]);

  // 方程确认 → 建元素落点（技术方案 §8）：外框中心 = 画布可视区中心；
  // 默认 480×360 超出可视区时按比例收缩。创建后自动选中并切回 select。
  useEffect(() => {
    if (!pendingMathPlot) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const vp = useStore.getState().viewport;
    const center = screenToCanvas({ x: rect.width / 2, y: rect.height / 2 }, vp);
    const el = createMathPlotElement(pendingMathPlot.payload, {
      centerX: center.x,
      centerY: center.y,
      maxWidth: (rect.width / vp.scale) * 0.8,
      maxHeight: (rect.height / vp.scale) * 0.8,
      strokeColor: pendingMathPlot.strokeColor,
      strokeWidth: pendingMathPlot.strokeWidth,
    });
    addElement(el);
    setTool('select'); // setTool 清选中，故先切工具再选中
    setSelected(el.id);
    consumeMathPlotInsert();
  }, [pendingMathPlot, addElement, setTool, setSelected, consumeMathPlotInsert]);

  const getCanvasPoint = useCallback((e: React.MouseEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return screenToCanvas({ x: e.clientX - rect.left, y: e.clientY - rect.top }, viewport);
  }, [viewport]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (spaceDown || e.button === 1) {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      panOffsetStartRef.current = { x: viewport.offsetX, y: viewport.offsetY };
      return;
    }

    const point = getCanvasPoint(e);
    dragStartRef.current = point;
    isDrawingRef.current = true;

    if (activeTool === 'select') {
      // mathPlot 控点缩放优先于元素命中（D-1：8 控点画在包围盒外沿）
      const sel = elements.find((e) => e.id === selectedId);
      if (sel && sel.type === 'mathPlot') {
        const rect = canvasRef.current!.getBoundingClientRect();
        const handle = hitTestSelectionHandle(sel, { x: e.clientX - rect.left, y: e.clientY - rect.top }, viewport);
        if (handle) {
          resizeRef.current = { handle, startEl: { ...sel }, startWorld: point };
          isDrawingRef.current = false; // 缩放手势独立提交，防止滞留的 select-drag 在 mouseLeave 时用陈旧起点压脏快照
          return;
        }
      }
      let found = false;
      for (let i = elements.length - 1; i >= 0; i--) {
        if (hitTest(elements[i], point, viewport)) {
          setSelected(elements[i].id);
          dragElementStartRef.current = { x: elements[i].x, y: elements[i].y };
          found = true;
          break;
        }
      }
      if (!found) setSelected(null);
      return;
    }

    // equation 工具不在画布上落笔：输入与确认在右侧方程面板
    if (activeTool === 'equation') {
      isDrawingRef.current = false;
      return;
    }

    if (activeTool === 'pen') {
      const el: PathElement = {
        id: uuidv4(), type: 'path',
        x: point.x, y: point.y,
        points: [{ x: point.x, y: point.y }],
        strokeColor, strokeWidth, opacity: 1,
      };
      tempElementRef.current = el;
      return;
    }

    if (activeTool === 'eraser') {
      for (let i = elements.length - 1; i >= 0; i--) {
        if (hitTest(elements[i], point, viewport)) {
          useStore.getState().deleteElement(elements[i].id);
          break;
        }
      }
      return;
    }

    if (activeTool === 'text') {
      const content = prompt('Enter text:');
      if (content) {
        addElement({
          id: uuidv4(), type: 'text',
          x: point.x, y: point.y,
          content, fontSize, fontFamily: 'sans-serif',
          color: strokeColor, strokeColor, strokeWidth: 1, opacity: 1,
          width: content.length * fontSize * 0.6, height: fontSize * 1.3,
        } as WhiteboardElement);
      }
      isDrawingRef.current = false;
      return;
    }

    // Shape tools start
    if (['rectangle', 'circle', 'line', 'arrow'].includes(activeTool)) {
      const base = {
        id: uuidv4(), x: point.x, y: point.y,
        strokeColor, strokeWidth, opacity: 1,
      };
      switch (activeTool) {
        case 'rectangle':
          tempElementRef.current = { ...base, type: 'rectangle', width: 0, height: 0, fillColor } as any;
          break;
        case 'circle':
          tempElementRef.current = { ...base, type: 'circle', width: 0, height: 0, fillColor } as any;
          break;
        case 'line':
          tempElementRef.current = { ...base, type: 'line', x2: point.x, y2: point.y } as any;
          break;
        case 'arrow':
          tempElementRef.current = { ...base, type: 'arrow', x2: point.x, y2: point.y } as any;
          break;
      }
    }
  }, [activeTool, elements, selectedId, strokeColor, strokeWidth, fillColor, fontSize, spaceDown, viewport, getCanvasPoint, setSelected, addElement]);

  // pan 帧回调：只读 ref，无需依赖数组
  const applyPanFromRaf = useCallback(() => {
    panRafRef.current = null;
    const d = panPendingRef.current;
    if (!d) return;
    panPendingRef.current = null;
    setViewport({
      offsetX: panOffsetStartRef.current.x + d.x,
      offsetY: panOffsetStartRef.current.y + d.y,
    });
  }, [setViewport]);

  // 卸载时取消未决 rAF
  useEffect(() => {
    return () => {
      if (panRafRef.current !== null) cancelAnimationFrame(panRafRef.current);
    };
  }, []);

  /** 控点缩放几何（§5.2 缩放语义）：equalRatio 角拖拽锁定纵横比 → y 视窗随宽高比保持，圆不变形。 */
  const applyResize = useCallback((rs: { handle: MathPlotHandle; startEl: MathPlotElement; startWorld: Point }, world: Point) => {
    const { viewport } = useStore.getState();
    const minW = Math.max(MATHPLOT_MIN_WIDTH, 48 / viewport.scale);
    const minH = Math.max(MATHPLOT_MIN_HEIGHT, 36 / viewport.scale);
    const { startEl, handle } = rs;
    let left = startEl.x;
    let top = startEl.y;
    let right = startEl.x + startEl.width;
    let bottom = startEl.y + startEl.height;

    if (handle.includes('w')) left = Math.min(world.x, right - minW);
    if (handle.includes('e')) right = Math.max(world.x, left + minW);
    if (handle.includes('n')) top = Math.min(world.y, bottom - minH);
    if (handle.includes('s')) bottom = Math.max(world.y, top + minH);

    let width = right - left;
    let height = bottom - top;
    if (startEl.equalRatio && handle.length === 2) {
      const aspect = startEl.height / startEl.width;
      // 主导轴优先：x 变化折算的 height 与直接拖出的 height 取更接近拖拽意图的一侧
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
    return { x: left, y: top, width: Math.max(width, minW), height: Math.max(height, minH) };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanningRef.current) {
      panPendingRef.current = { x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y };
      if (panRafRef.current === null) {
        panRafRef.current = requestAnimationFrame(applyPanFromRaf);
      }
      return;
    }

    // mathPlot 控点缩放拖拽（静默直改，mouseUp 统一压快照 —— 与移动拖拽同构）
    const rs = resizeRef.current;
    if (rs) {
      const point = getCanvasPoint(e);
      const next = applyResize(rs, point);
      useStore.setState({
        elements: useStore.getState().elements.map((el) =>
          el.id === rs.startEl.id ? { ...el, ...next } : el
        ),
      });
      return;
    }

    if (!isDrawingRef.current) return;
    const point = getCanvasPoint(e);
    const temp = tempElementRef.current;
    if (!temp) {
      // Select tool dragging
      if (activeTool === 'select' && selectedId) {
        const dx = point.x - dragStartRef.current.x;
        const dy = point.y - dragStartRef.current.y;
        const el = useStore.getState().elements.find((e) => e.id === selectedId);
        if (el) {
          useStore.setState({
            elements: useStore.getState().elements.map((e) =>
              e.id === selectedId
                ? { ...e, x: dragElementStartRef.current.x + dx, y: dragElementStartRef.current.y + dy }
                : e
            ),
          });
        }
      }
      // Eraser drag
      if (activeTool === 'eraser') {
        for (let i = useStore.getState().elements.length - 1; i >= 0; i--) {
          if (hitTest(useStore.getState().elements[i], point, viewport)) {
            useStore.getState().deleteElement(useStore.getState().elements[i].id);
            break;
          }
        }
      }
      return;
    }

    if (temp.type === 'path') {
      temp.points.push({ x: point.x, y: point.y });
    } else if (temp.type === 'rectangle' || temp.type === 'circle') {
      temp.width = point.x - temp.x;
      temp.height = point.y - temp.y;
    } else if (temp.type === 'line' || temp.type === 'arrow') {
      (temp as any).x2 = point.x;
      (temp as any).y2 = point.y;
    }
    render();
  }, [activeTool, selectedId, viewport, getCanvasPoint, render, applyPanFromRaf, applyResize]);

  const handleMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      // 结束 pan：取消未决帧并同步落定最终位移（避免停留在倒数第二帧位置）
      if (panRafRef.current !== null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      const d = panPendingRef.current;
      panPendingRef.current = null;
      if (d) {
        setViewport({
          offsetX: panOffsetStartRef.current.x + d.x,
          offsetY: panOffsetStartRef.current.y + d.y,
        });
      }
      return;
    }
    // mathPlot 缩放提交：一次拖拽 = 一条可撤销快照（D5 同构）
    const rs = resizeRef.current;
    if (rs) {
      resizeRef.current = null;
      const cur = useStore.getState().elements.find((el): el is MathPlotElement => el.id === rs.startEl.id && el.type === 'mathPlot');
      if (cur) {
        const moved =
          cur.x !== rs.startEl.x || cur.y !== rs.startEl.y ||
          cur.width !== rs.startEl.width || cur.height !== rs.startEl.height;
        if (moved) {
          pushOperations([{
            type: 'update', elementId: rs.startEl.id,
            before: rs.startEl,
            after: { ...cur },
          }]);
        }
      }
      return;
    }

    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const temp = tempElementRef.current;
    if (temp) {
      addElement(temp);
      tempElementRef.current = null;
    }

    // Commit select drag
    if (activeTool === 'select' && selectedId) {
      const el = useStore.getState().elements.find((e) => e.id === selectedId);
      if (el) {
        const orig = { x: dragElementStartRef.current.x, y: dragElementStartRef.current.y };
        if (el.x !== orig.x || el.y !== orig.y) {
          useStore.getState().pushOperations([{
            type: 'update', elementId: selectedId,
            before: { ...el, x: orig.x, y: orig.y },
            after: { ...el },
          }]);
        }
      }
    }
  }, [activeTool, selectedId, addElement, setViewport, pushOperations]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { scale, offsetX, offsetY } = viewport;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, scale * factor));
    const newOffsetX = mx - (mx - offsetX) * (newScale / scale);
    const newOffsetY = my - (my - offsetY) * (newScale / scale);
    setViewport({ offsetX: newOffsetX, offsetY: newOffsetY, scale: newScale });
  }, [viewport, setViewport]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); setSpaceDown(true); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: spaceDown ? 'grab' : activeTool === 'select' ? 'default' : 'crosshair' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {activeTool === 'equation' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-[5]">
          <div className="px-4 py-2 bg-white/90 backdrop-blur-sm rounded-full shadow border border-gray-200 text-sm text-gray-500 flex items-center gap-1.5">
            <span className="font-serif italic text-blue-500">ƒ</span>
            在右侧面板输入方程，回车插入图形
          </div>
        </div>
      )}
    </div>
  );
}
