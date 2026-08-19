/**
 * 选中元素改色 / 改线宽单测（ZOO-157）：
 * - pickStrokeColor：选中 → 元素立即变色（PM 实测场景：黑矩形点红 → 红），单条可撤销快照，undo 回退；
 * - text 双字段同步（渲染读 color，面板 / 建档读 strokeColor）；
 * - mathPlot 选中不参与（专属参数面板，防回归）；无选中 → 仅设默认色（原语义）；
 * - inputStrokeColor / inputStrokeWidth 连续手势 D5 两段式：拖动不入栈、收尾一条快照；
 * - strokeColorPatch / elementStrokeColor 纯函数。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { WhiteboardElement, MathPlotElement } from '../types';
import { strokeColorPatch, elementStrokeColor } from '../stroke';

const RED = '#EF4444';

const rect = (id = 'rect-1'): WhiteboardElement => ({
  id, type: 'rectangle', x: 0, y: 0, width: 100, height: 60,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
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

const el = (id: string) => useStore.getState().elements.find((e) => e.id === id)!;

beforeEach(() => {
  useStore.setState({
    elements: [],
    selectedId: null,
    activeTool: 'select',
    strokeColor: '#000000',
    strokeWidth: 2,
    undoStack: [],
    redoStack: [],
    isDirty: false,
    strokeGestureBefore: null,
  });
});

describe('pickStrokeColor（色板点选 → 选中元素立即改色）', () => {
  it('PM 实测场景：选中黑色矩形点红 → 元素 strokeColor 变红（红色像素出现、黑色消失的数据侧）', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickStrokeColor(RED);
    expect(el('rect-1').strokeColor).toBe(RED);
  });

  it('同步默认色：下一个新绘制元素沿用所选颜色', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickStrokeColor(RED);
    expect(useStore.getState().strokeColor).toBe(RED);
  });

  it('可撤销：一条 update 快照，Ctrl+Z 语义回退到黑色', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickStrokeColor(RED);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(el('rect-1').strokeColor).toBe('#000000');
  });

  it('redo 重做恢复红色', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickStrokeColor(RED);
    useStore.getState().undo();
    useStore.getState().redo();
    expect(el('rect-1').strokeColor).toBe(RED);
  });

  it('改动标记 isDirty（持久化通道正常）', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickStrokeColor(RED);
    expect(useStore.getState().isDirty).toBe(true);
  });

  it('text：color（渲染字段）与 strokeColor 同步改，undo 同时回退两字段', () => {
    useStore.setState({ elements: [textEl()], selectedId: 'text-1' });
    useStore.getState().pickStrokeColor(RED);
    const t = el('text-1') as Extract<WhiteboardElement, { type: 'text' }>;
    expect(t.strokeColor).toBe(RED);
    expect(t.color).toBe(RED);
    useStore.getState().undo();
    const back = el('text-1') as Extract<WhiteboardElement, { type: 'text' }>;
    expect(back.strokeColor).toBe('#000000');
    expect(back.color).toBe('#000000');
  });

  it('mathPlot 选中不参与（专属参数面板改色，防回归）：元素不被触碰', () => {
    useStore.setState({ elements: [mathPlot()], selectedId: 'mp-1' });
    useStore.getState().pickStrokeColor(RED);
    expect(el('mp-1').strokeColor).toBe('#3B82F6');
    expect(useStore.getState().undoStack).toHaveLength(0);
    // 默认色照常同步（mathPlot 面板自身不读默认色，互不影响）
    expect(useStore.getState().strokeColor).toBe(RED);
  });

  it('无选中 → 维持原语义：仅设默认色，元素与撤销栈不动', () => {
    useStore.setState({ elements: [rect()], selectedId: null });
    useStore.getState().pickStrokeColor(RED);
    expect(el('rect-1').strokeColor).toBe('#000000');
    expect(useStore.getState().strokeColor).toBe(RED);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

describe('线宽滑杆（inputStrokeWidth + commitStrokeStyle，D5 两段式）', () => {
  it('选中直线：拖动实时改元素 strokeWidth（直改不入栈）', () => {
    useStore.setState({
      elements: [{ id: 'line-1', type: 'line', x: 0, y: 0, x2: 100, y2: 100, strokeColor: '#000000', strokeWidth: 2, opacity: 1 }],
      selectedId: 'line-1',
    });
    useStore.getState().inputStrokeWidth(7);
    expect(el('line-1').strokeWidth).toBe(7);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('一次拖动多条 input 事件 → 收尾只压一条快照，undo 整体回退', () => {
    useStore.setState({
      elements: [{ id: 'line-1', type: 'line', x: 0, y: 0, x2: 100, y2: 100, strokeColor: '#000000', strokeWidth: 2, opacity: 1 }],
      selectedId: 'line-1',
    });
    useStore.getState().inputStrokeWidth(5);
    useStore.getState().inputStrokeWidth(9);
    useStore.getState().inputStrokeWidth(12);
    useStore.getState().commitStrokeStyle();
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(el('line-1').strokeWidth).toBe(2);
  });

  it('默认线宽同步：后续新元素沿用', () => {
    useStore.setState({
      elements: [{ id: 'line-1', type: 'line', x: 0, y: 0, x2: 100, y2: 100, strokeColor: '#000000', strokeWidth: 2, opacity: 1 }],
      selectedId: 'line-1',
    });
    useStore.getState().inputStrokeWidth(6);
    expect(useStore.getState().strokeWidth).toBe(6);
  });

  it('无选中 → 仅设默认线宽，元素不动、收尾不压栈', () => {
    useStore.setState({
      elements: [{ id: 'line-1', type: 'line', x: 0, y: 0, x2: 100, y2: 100, strokeColor: '#000000', strokeWidth: 2, opacity: 1 }],
      selectedId: null,
    });
    useStore.getState().inputStrokeWidth(9);
    useStore.getState().commitStrokeStyle();
    expect(el('line-1').strokeWidth).toBe(2);
    expect(useStore.getState().strokeWidth).toBe(9);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('收尾无改动不压栈（点一下滑杆原值放开）', () => {
    useStore.setState({
      elements: [{ id: 'line-1', type: 'line', x: 0, y: 0, x2: 100, y2: 100, strokeColor: '#000000', strokeWidth: 2, opacity: 1 }],
      selectedId: 'line-1',
    });
    useStore.getState().inputStrokeWidth(2); // 值未变
    useStore.getState().commitStrokeStyle();
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

describe('自定义取色器（inputStrokeColor 连续手势）', () => {
  it('拖动过程多次变色不入栈，失焦收尾压一条快照，undo 回退到起手色', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().inputStrokeColor('#FF0000');
    useStore.getState().inputStrokeColor('#00FF00');
    useStore.getState().inputStrokeColor(RED);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(el('rect-1').strokeColor).toBe(RED);
    useStore.getState().commitStrokeStyle();
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(el('rect-1').strokeColor).toBe('#000000');
  });

  it('颜色 + 线宽同一连续手势（快照只压一条，undo 同时回退两属性）', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().inputStrokeColor(RED);
    useStore.getState().inputStrokeWidth(9);
    useStore.getState().commitStrokeStyle();
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(el('rect-1').strokeColor).toBe('#000000');
    expect(el('rect-1').strokeWidth).toBe(2);
  });
});

describe('strokeColorPatch / elementStrokeColor（纯函数）', () => {
  it('text 补丁含 color + strokeColor；其余类型仅 strokeColor', () => {
    expect(strokeColorPatch(textEl(), RED)).toEqual({ strokeColor: RED, color: RED });
    expect(strokeColorPatch(rect(), RED)).toEqual({ strokeColor: RED });
  });

  it('elementStrokeColor：text 读 color，其余读 strokeColor（面板高亮回显）', () => {
    expect(elementStrokeColor(textEl())).toBe('#000000');
    const t = textEl() as Extract<WhiteboardElement, { type: 'text' }>;
    expect(elementStrokeColor({ ...t, color: RED, strokeColor: '#000000' })).toBe(RED);
    expect(elementStrokeColor(rect())).toBe('#000000');
  });
});
