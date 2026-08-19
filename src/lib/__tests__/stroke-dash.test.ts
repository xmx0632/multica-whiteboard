/**
 * 线型（dash）单测（ZOO-165）：
 * - 纯函数：elementDash（旧文档缺省读 solid）/ dashPatternFor（按线宽比例）/ canDashFromToolPanel；
 * - 渲染分支：renderer 对 dashed/dotted 设 setLineDash（× scale），solid / 旧元素不触碰；
 * - SVG 导出：stroke-dasharray 同步（世界 px），solid 输出不变（零回归）；
 * - 序列化：dash 字段 JSON 往返（持久化 / 撤销重做链路）；
 * - store：pickStrokeDash 选中立即改（单条可撤销快照）/ 无选中设默认 / text 与 mathPlot 不参与；
 * - 线宽回归（ZOO-157 补核对）：arrow / line / rectangle / circle 选中改线宽即时生效。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { WhiteboardElement, MathPlotElement, StrokeDashStyle, Viewport } from '../types';
import { canDashFromToolPanel, dashPatternFor, elementDash } from '../stroke';
import { renderElement } from '../renderer';
import { exportToSvg } from '../export';

const VP: Viewport = { offsetX: 0, offsetY: 0, scale: 1 };

const rect = (dash?: StrokeDashStyle): WhiteboardElement => ({
  id: 'rect-1', type: 'rectangle', x: 0, y: 0, width: 100, height: 60,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
  ...(dash ? { dash } : {}),
});

const arrow = (): WhiteboardElement => ({
  id: 'arrow-1', type: 'arrow', x: 0, y: 0, x2: 100, y2: 0,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1,
});

const line = (): WhiteboardElement => ({
  id: 'line-1', type: 'line', x: 0, y: 0, x2: 100, y2: 100,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1,
});

const circleEl = (): WhiteboardElement => ({
  id: 'circle-1', type: 'circle', x: 0, y: 0, width: 80, height: 80,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

const pathEl = (dash?: StrokeDashStyle): WhiteboardElement => ({
  id: 'path-1', type: 'path', x: 0, y: 0,
  points: [{ x: 0, y: 0 }, { x: 40, y: 40 }],
  strokeColor: '#000000', strokeWidth: 2, opacity: 1,
  ...(dash ? { dash } : {}),
});

const textEl = (): WhiteboardElement => ({
  id: 'text-1', type: 'text', x: 0, y: 0, content: 'hi', fontSize: 20,
  fontFamily: 'sans-serif', color: '#000000', strokeColor: '#000000',
  strokeWidth: 1, opacity: 1, width: 24, height: 26,
});

const mathPlot = (): MathPlotElement => ({
  id: 'mp-1', type: 'mathPlot', x: 0, y: 0, width: 480, height: 360,
  strokeColor: '#3B82F6', strokeWidth: 2, opacity: 1,
  equation: 'y=sin(x)', kind: 'explicit', error: null,
  xAxis: { min: -10, max: 10 }, equalRatio: true, sampleCount: 320,
  showAxis: true, showGrid: true, showLabel: true,
});

/** 记录型 ctx stub（同 mathplot-integration.test.ts 模式） */
function createMockCtx() {
  const calls: { op: string; args: unknown[] }[] = [];
  const ctx = new Proxy(
    { calls },
    {
      get(target, prop: string) {
        if (prop === 'calls') return target.calls;
        if (prop === 'measureText') return () => ({ width: 10 });
        return (...args: unknown[]) => {
          target.calls.push({ op: prop, args });
        };
      },
      set(target, prop: string, value) {
        target.calls.push({ op: `set:${prop}`, args: [value] });
        return true;
      },
    }
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const el = (id: string) => useStore.getState().elements.find((e) => e.id === id)!;

beforeEach(() => {
  useStore.setState({
    elements: [],
    selectedId: null,
    activeTool: 'select',
    strokeColor: '#000000',
    strokeWidth: 2,
    strokeDash: 'solid',
    undoStack: [],
    redoStack: [],
    isDirty: false,
    strokeGestureBefore: null,
  });
});

describe('elementDash / canDashFromToolPanel（向后兼容）', () => {
  it('旧文档无 dash 字段 → 读作 solid（渲染 / 面板统一入口）', () => {
    expect(elementDash(rect())).toBe('solid');
    expect(elementDash(line())).toBe('solid');
  });

  it('有 dash 字段原样读出', () => {
    expect(elementDash(rect('dashed'))).toBe('dashed');
    expect(elementDash(pathEl('dotted'))).toBe('dotted');
  });

  it('canDashFromToolPanel：仅描边类元素（path/rect/circle/line/arrow）', () => {
    expect(canDashFromToolPanel(rect())).toBe(true);
    expect(canDashFromToolPanel(circleEl())).toBe(true);
    expect(canDashFromToolPanel(line())).toBe(true);
    expect(canDashFromToolPanel(arrow())).toBe(true);
    expect(canDashFromToolPanel(pathEl())).toBe(true);
    expect(canDashFromToolPanel(textEl())).toBe(false);
    expect(canDashFromToolPanel(mathPlot())).toBe(false);
    expect(canDashFromToolPanel(null)).toBe(false);
  });

  it('JSON 序列化往返：dash 字段随元素持久化（localStorage / 服务端同通道）', () => {
    const round = JSON.parse(JSON.stringify(rect('dashed'))) as WhiteboardElement;
    expect(round.dash).toBe('dashed');
    const legacy = JSON.parse('{"id":"r","type":"rectangle","x":0,"y":0,"width":10,"height":10,"strokeColor":"#000","strokeWidth":2,"opacity":1,"fillColor":null}') as WhiteboardElement;
    expect(elementDash(legacy)).toBe('solid');
  });
});

describe('dashPatternFor（按线宽比例）', () => {
  it('solid / 缺省 → 空数组（实线，不设置 dash）', () => {
    expect(dashPatternFor('solid', 2)).toEqual([]);
    expect(dashPatternFor(undefined, 2)).toEqual([]);
  });

  it('dashed → [4w, 3w]：随线宽缩放，粗线虚线段更长', () => {
    expect(dashPatternFor('dashed', 2)).toEqual([8, 6]);
    expect(dashPatternFor('dashed', 5)).toEqual([20, 15]);
  });

  it('dotted → 近零长 dash 段 + 间隔随线宽（round cap 出圆点）', () => {
    expect(dashPatternFor('dotted', 2)).toEqual([0.2, 4.8]);
    expect(dashPatternFor('dotted', 5)).toEqual([0.2, 12]);
  });
});

describe('渲染分支（renderer.setLineDash）', () => {
  it('dashed 矩形：setLineDash 收到世界 px 模式', () => {
    const { ctx, calls } = createMockCtx();
    renderElement(ctx, rect('dashed'), VP);
    expect(calls.find((c) => c.op === 'setLineDash')?.args).toEqual([[8, 6]]);
  });

  it('高缩放密度稳定：scale 2 时模式 × 2（与线宽同步缩放）', () => {
    const { ctx, calls } = createMockCtx();
    renderElement(ctx, rect('dashed'), { offsetX: 0, offsetY: 0, scale: 2 });
    expect(calls.find((c) => c.op === 'setLineDash')?.args).toEqual([[16, 12]]);
  });

  it('dotted 直线：近零 dash 段模式', () => {
    const { ctx, calls } = createMockCtx();
    renderElement(ctx, { ...line(), dash: 'dotted' } as WhiteboardElement, VP);
    expect(calls.find((c) => c.op === 'setLineDash')?.args).toEqual([[0.2, 4.8]]);
  });

  it('描边类五类型均走 dash 通道（path/rect/circle/line/arrow）', () => {
    for (const target of [pathEl('dashed'), rect('dashed'), circleEl(), line(), arrow()]) {
      const { ctx, calls } = createMockCtx();
      renderElement(ctx, { ...target, dash: 'dashed' } as WhiteboardElement, VP);
      expect(calls.find((c) => c.op === 'setLineDash')?.args).toEqual([[8, 6]]);
    }
  });

  it('solid / 旧文档缺 dash：不调用 setLineDash（零回归）', () => {
    for (const target of [pathEl(), rect(), circleEl(), line(), arrow()]) {
      const { ctx, calls } = createMockCtx();
      renderElement(ctx, target, VP);
      expect(calls.find((c) => c.op === 'setLineDash')).toBeUndefined();
    }
  });
});

describe('SVG 导出（stroke-dasharray 同步）', () => {
  it('dashed 矩形 → stroke-dasharray="8,6"（世界 px，与 strokeWidth 同单位）', () => {
    const svg = exportToSvg([rect('dashed')]);
    expect(svg).toContain('<rect ');
    expect(svg).toContain('stroke-dasharray="8,6"');
  });

  it('dotted 直线 → 点线模式；粗线比例放大', () => {
    const svg = exportToSvg([{ ...line(), dash: 'dotted', strokeWidth: 5 } as WhiteboardElement]);
    expect(svg).toContain('stroke-dasharray="0.2,12"');
  });

  it('solid / 旧元素：输出不含 stroke-dasharray（既有 SVG 结构零变化）', () => {
    const svg = exportToSvg([rect(), line(), arrow()]);
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('dashed 箭头：杆身带 dasharray、箭头头部 polygon 不带（填充图形无描边）', () => {
    const svg = exportToSvg([{ ...arrow(), dash: 'dashed' } as WhiteboardElement]);
    expect(svg).toContain('stroke-dasharray="8,6"');
    expect(svg).toContain('<polygon');
    const polygon = svg.slice(svg.indexOf('<polygon'));
    expect(polygon).not.toContain('stroke-dasharray');
  });
});

describe('pickStrokeDash（选中改线型 / 新绘制默认）', () => {
  it('选中矩形切虚线 → 元素 dash 立即生效（PM 验收场景的数据侧）', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickStrokeDash('dashed');
    expect(el('rect-1').dash).toBe('dashed');
  });

  it('单条可撤销快照：undo 回 solid，redo 恢复 dashed', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickStrokeDash('dashed');
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(el('rect-1').dash).toBeUndefined();
    useStore.getState().redo();
    expect(el('rect-1').dash).toBe('dashed');
  });

  it('改动标记 isDirty（持久化通道）', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickStrokeDash('dotted');
    expect(useStore.getState().isDirty).toBe(true);
  });

  it('默认线型同步：无选中时设默认，后续新绘制沿用', () => {
    useStore.setState({ elements: [rect()], selectedId: null });
    useStore.getState().pickStrokeDash('dashed');
    expect(useStore.getState().strokeDash).toBe('dashed');
    expect(el('rect-1').dash).toBeUndefined();
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('选中时同步默认：切走选中后新元素也是虚线', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickStrokeDash('dashed');
    expect(useStore.getState().strokeDash).toBe('dashed');
  });

  it('text / mathPlot 选中不参与：元素不被触碰（默认照常同步）', () => {
    useStore.setState({ elements: [textEl(), mathPlot()], selectedId: 'text-1' });
    useStore.getState().pickStrokeDash('dashed');
    expect(el('text-1').dash).toBeUndefined();
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().strokeDash).toBe('dashed');

    useStore.setState({ selectedId: 'mp-1', strokeDash: 'solid', undoStack: [] });
    useStore.getState().pickStrokeDash('dotted');
    expect(el('mp-1').dash).toBeUndefined();
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

describe('线宽回归（ZOO-165 核对：arrow/line/rect/circle 选中改线宽即时生效）', () => {
  it.each([
    ['arrow-1', arrow()],
    ['line-1', line()],
    ['rect-1', rect()],
    ['circle-1', circleEl()],
  ] as const)('%s：inputStrokeWidth 直改不入栈，收尾单快照可撤销', (id, element) => {
    useStore.setState({ elements: [element], selectedId: id });
    useStore.getState().inputStrokeWidth(9);
    expect(el(id).strokeWidth).toBe(9);
    expect(useStore.getState().undoStack).toHaveLength(0);
    useStore.getState().commitStrokeStyle();
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(el(id).strokeWidth).toBe(2);
  });
});
