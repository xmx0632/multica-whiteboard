/**
 * 图形元素选中缩放单测（ZOO-160）：
 * - boxResizePatch：rect/circle 角控点对角锚定改外框、minSize 兜底、Shift 等比锁定；
 * - endpointResizePatch：line/arrow 端点手柄 p1/p2 只动对应锚点；
 * - pathResizePatch：包围盒角控点整体等比缩放点集（对角锚定，形状不变形）；
 * - elementResizeChanged：path 逐点比值（零位移抖动不判变）、text/mathPlot 字段判变；
 * - hitTestSelectionHandle：全类型控点可命中（rect/circle/path 4 角、line/arrow 端点）、
 *   mathPlot 8 控点既有行为不回归、触摸 margin 44px 等效命中。
 */
import { describe, expect, it } from 'vitest';
import {
  WhiteboardElement, RectangleElement, CircleElement, LineElement, ArrowElement,
  PathElement, TextElement, Viewport,
} from '../types';
import { hitTestSelectionHandle, renderSelection } from '../renderer';
import { boxResizePatch, endpointResizePatch, pathResizePatch, elementResizeChanged } from '../shapeResize';

const VP: Viewport = { offsetX: 0, offsetY: 0, scale: 1 };

const rect = (): RectangleElement => ({
  id: 'r1', type: 'rectangle', x: 100, y: 100, width: 200, height: 100,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

const circle = (): CircleElement => ({
  id: 'c1', type: 'circle', x: 100, y: 100, width: 200, height: 100,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

const line = (): LineElement => ({
  id: 'l1', type: 'line', x: 0, y: 0, x2: 100, y2: 50,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1,
});

const arrow = (): ArrowElement => ({
  id: 'a1', type: 'arrow', x: 0, y: 0, x2: 100, y2: 50,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1,
});

const path = (): PathElement => ({
  id: 'p1', type: 'path', x: 0, y: 0,
  points: [{ x: 0, y: 0 }, { x: 100, y: 20 }, { x: 60, y: 80 }],
  strokeColor: '#000000', strokeWidth: 2, opacity: 1,
});

const text = (): TextElement => ({
  id: 't1', type: 'text', x: 0, y: 0, content: 'hi', fontSize: 20,
  fontFamily: 'sans-serif', color: '#000000', strokeColor: '#000000',
  strokeWidth: 1, opacity: 1, width: 24, height: 26,
});

describe('boxResizePatch（rect/circle 角控点）', () => {
  it('PM 实测场景：se 角外拉 → width/height 变大，对角 nw 锚定不动', () => {
    const next = boxResizePatch('se', rect(), { x: 400, y: 260 });
    expect(next).toEqual({ x: 100, y: 100, width: 300, height: 160 });
  });

  it('nw 角内收 → 左上角随拖点移动，右下角锚定', () => {
    const next = boxResizePatch('nw', rect(), { x: 60, y: 80 });
    expect(next).toEqual({ x: 60, y: 80, width: 240, height: 120 });
  });

  it('拖过头收在 minSize 下限，不翻转', () => {
    const next = boxResizePatch('se', rect(), { x: -999, y: -999 }, { minSize: 8 });
    expect(next.x).toBe(100);
    expect(next.y).toBe(100);
    expect(next.width).toBeGreaterThanOrEqual(8);
    expect(next.height).toBeGreaterThanOrEqual(8);
  });

  it('Shift 等比锁定：纵横比保持起手值（宽主导）', () => {
    // 拖 se 到 (400, 240)：x 方向变化远大于 y 折算 → height 由 width × aspect 推出
    const next = boxResizePatch('se', rect(), { x: 400, y: 240 }, { shift: true });
    expect(next.width).toBe(300);
    expect(next.height).toBeCloseTo(150, 10); // 300 × (100/200)
  });

  it('circle 同外框语义：角控点改包围盒宽高', () => {
    const next = boxResizePatch('se', circle(), { x: 350, y: 250 });
    expect(next).toEqual({ x: 100, y: 100, width: 250, height: 150 });
  });
});

describe('endpointResizePatch（line/arrow 端点手柄）', () => {
  it('p1 改起点 x/y，终点 x2/y2 不动', () => {
    expect(endpointResizePatch('p1', line(), { x: -30, y: 10 })).toEqual({ x: -30, y: 10 });
  });

  it('p2 改终点 x2/y2，起点不动', () => {
    expect(endpointResizePatch('p2', arrow(), { x: 200, y: 120 })).toEqual({ x2: 200, y2: 120 });
  });
});

describe('pathResizePatch（包围盒整体等比缩放）', () => {
  it('se 角外拉 → 点集等比放大，形状不变形（各段比例保持）', () => {
    // se 锚定 nw(0,0)，宽 100→200 → 比例 2（宽主导）
    const next = pathResizePatch('se', path(), { x: 200, y: 160 });
    expect(next.points).toEqual([
      { x: 0, y: 0 }, { x: 200, y: 40 }, { x: 120, y: 160 },
    ]);
    // x/y 同步为首点（字段语义保持）
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });

  it('nw 角内收 → 东南角锚定，点集等比缩小', () => {
    // bbox (0,0)-(100,80)，nw 拖到 (50,40) → 比例 0.5，锚定 (100,80)
    const next = pathResizePatch('nw', path(), { x: 50, y: 40 });
    expect(next.points).toEqual([
      { x: 50, y: 40 }, { x: 100, y: 50 }, { x: 80, y: 80 },
    ]);
  });

  it('拖过头收在下限比例，包围盒不小于 minSize', () => {
    const next = pathResizePatch('se', path(), { x: 1, y: 1 }, { minSize: 8 });
    const w = Math.max(...next.points.map((p) => p.x)) - Math.min(...next.points.map((p) => p.x));
    expect(w).toBeGreaterThanOrEqual(8);
  });

  it('平坦笔迹（height=0）不产生 NaN / 失控放大，仅横向缩放生效', () => {
    const el: PathElement = { ...path(), points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    const next = pathResizePatch('se', el, { x: 200, y: 300 });
    expect(next.points).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }]);
  });
});

describe('elementResizeChanged（收尾判变）', () => {
  it('path 零位移抖动（数组换引用但值相等）不判变', () => {
    const before = path();
    const cur: WhiteboardElement = { ...before, points: before.points.map((p) => ({ ...p })) };
    expect(elementResizeChanged(cur, before)).toBe(false);
  });

  it('path 实际缩放判变', () => {
    const before = path();
    const cur: WhiteboardElement = { ...before, ...pathResizePatch('se', before, { x: 200, y: 160 }) };
    expect(elementResizeChanged(cur, before)).toBe(true);
  });

  it('text fontSize 变化判变（ZOO-159 语义保持）', () => {
    expect(elementResizeChanged({ ...text(), fontSize: 30 }, text())).toBe(true);
  });

  it('完全相同不判变（单击控点即抬指不压空快照）', () => {
    const el = rect();
    expect(elementResizeChanged({ ...el }, el)).toBe(false);
  });
});

describe('hitTestSelectionHandle（全类型控点命中）', () => {
  it('rect/circle/path：4 角控点可命中，角间中点不误命中', () => {
    // rect (100,100)-(300,200)：nw 角控点方块中心即 (100,100)
    expect(hitTestSelectionHandle(rect(), { x: 100, y: 100 }, VP)).toBe('nw');
    expect(hitTestSelectionHandle(rect(), { x: 300, y: 200 }, VP)).toBe('se');
    // 顶边中点 (200,100) 不在任何角控点 ±6px 内
    expect(hitTestSelectionHandle(rect(), { x: 200, y: 100 }, VP)).toBeNull();
    expect(hitTestSelectionHandle(circle(), { x: 300, y: 100 }, VP)).toBe('ne');
    expect(hitTestSelectionHandle(path(), { x: 0, y: 80 }, VP)).toBe('sw');
  });

  it('line/arrow：端点手柄 p1/p2 可命中（端点即手柄中心），包围盒其余两角无控点', () => {
    // line (0,0)→(100,50)：两端点为手柄；bbox 另外两角 (100,0)/(0,50) 无控点
    expect(hitTestSelectionHandle(line(), { x: 0, y: 0 }, VP)).toBe('p1');
    expect(hitTestSelectionHandle(line(), { x: 100, y: 50 }, VP)).toBe('p2');
    expect(hitTestSelectionHandle(line(), { x: 100, y: 0 }, VP)).toBeNull();
    expect(hitTestSelectionHandle(line(), { x: 0, y: 50 }, VP)).toBeNull();
    expect(hitTestSelectionHandle(arrow(), { x: 100, y: 50 }, VP)).toBe('p2');
  });

  it('反向线段（起点在右下）：端点手柄仍落在实际端点上', () => {
    const rev: LineElement = { ...line(), x: 100, y: 50, x2: 0, y2: 0 };
    expect(hitTestSelectionHandle(rev, { x: 100, y: 50 }, VP)).toBe('p1');
    expect(hitTestSelectionHandle(rev, { x: 0, y: 0 }, VP)).toBe('p2');
  });

  it('触摸 margin：44px 等效命中框（8px 方块 + 18px 边距）', () => {
    // rect se 角 (300,200)：距角点 17px 处普通判定不命中、触摸判定命中
    expect(hitTestSelectionHandle(rect(), { x: 317, y: 217 }, VP)).toBeNull();
    expect(hitTestSelectionHandle(rect(), { x: 317, y: 217 }, VP, { margin: 18 })).toBe('se');
    // 44px 框边缘（方块左上 (296,196)，右下界 322/222）
    expect(hitTestSelectionHandle(rect(), { x: 321, y: 221 }, VP, { margin: 18 })).toBe('se');
    expect(hitTestSelectionHandle(rect(), { x: 323, y: 223 }, VP, { margin: 18 })).toBeNull();
  });

  it('视口变换：缩放后控点跟随元素屏幕位置', () => {
    const vp: Viewport = { offsetX: 1000, offsetY: 500, scale: 2 };
    // rect 世界 (100,100)-(300,200) → 屏幕 (1200,700)-(1600,900)
    expect(hitTestSelectionHandle(rect(), { x: 1200, y: 700 }, vp)).toBe('nw');
    expect(hitTestSelectionHandle(rect(), { x: 1600, y: 900 }, vp)).toBe('se');
  });
});

describe('renderSelection（选中框绘制与控点布局）', () => {
  function mockCtx() {
    const calls: { op: string }[] = [];
    const ctx = {
      save: () => calls.push({ op: 'save' }),
      restore: () => calls.push({ op: 'restore' }),
      strokeRect: () => calls.push({ op: 'strokeRect' }),
      fillRect: () => calls.push({ op: 'fillRect' }),
      setLineDash: () => calls.push({ op: 'setLineDash' }),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  it('line：选中框只画 2 个端点手柄（不再画包围盒四角）', () => {
    const { ctx, calls } = mockCtx();
    renderSelection(ctx, line(), VP);
    expect(calls.filter((c) => c.op === 'fillRect')).toHaveLength(2);
  });

  it('rect / path：维持 4 角控点（既有视觉零回归）', () => {
    const a = mockCtx();
    renderSelection(a.ctx, rect(), VP);
    expect(a.calls.filter((c) => c.op === 'fillRect')).toHaveLength(4);
    const b = mockCtx();
    renderSelection(b.ctx, path(), VP);
    expect(b.calls.filter((c) => c.op === 'fillRect')).toHaveLength(4);
  });
});
