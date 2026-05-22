'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '@/lib/store';
import { renderGrid, renderElements, renderSelection, hitTest, screenToCanvas } from '@/lib/renderer';
import { WhiteboardElement, PathElement, Point } from '@/lib/types';
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

  const {
    elements, selectedId, activeTool, strokeColor, strokeWidth, fillColor, fontSize,
    viewport, addElement, updateElement, setSelected, setViewport, pushOperations,
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
    renderElements(ctx, elements, viewport);
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
  }, [activeTool, elements, strokeColor, strokeWidth, fillColor, fontSize, spaceDown, viewport, getCanvasPoint, setSelected, addElement]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setViewport({
        offsetX: panOffsetStartRef.current.x + dx,
        offsetY: panOffsetStartRef.current.y + dy,
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
  }, [activeTool, selectedId, viewport, getCanvasPoint, render, setViewport]);

  const handleMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
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
  }, [activeTool, selectedId, addElement]);

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
    </div>
  );
}
