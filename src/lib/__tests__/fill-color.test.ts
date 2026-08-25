/**
 * 填充颜色（ZOO-228）单测——选中矩形/菱形/圆形内部填充：
 * - 纯函数：canFillFromToolPanel（仅三形状）/ elementFillColor（旧文档缺省读透明）；
 * - 渲染顺序：fill 先于 stroke（rect fillRect→strokeRect、circle/diamond fill→stroke）；
 * - SVG 导出：三形状 fill 属性同步、无填充 fill="none"；
 * - store：pickFillColor 选中立即改（单条可撤销批量快照）/ 清除回透明 / 多选批量
 *   （非形状跳过）/ 无选中仅设默认 / inputFillColor 直改 + commitFillStyle 单快照；
 * - 序列化：fillColor JSON 往返（保存重开保持，旧文档零迁移兼容）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { WhiteboardElement, Viewport } from '../types';
import { canFillFromToolPanel, elementFillColor } from '../stroke';
import { renderElement } from '../renderer';
import { exportToSvg } from '../export';

const VP: Viewport = { offsetX: 0, offsetY: 0, scale: 1 };

const rect = (fillColor: string | null = null): WhiteboardElement => ({
  id: 'rect-1', type: 'rectangle', x: 0, y: 0, width: 100, height: 60,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor,
});
const circleEl = (fillColor: string | null = null): WhiteboardElement => ({
  id: 'circle-1', type: 'circle', x: 0, y: 0, width: 80, height: 80,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor,
});
const diamondEl = (fillColor: string | null = null): WhiteboardElement => ({
  id: 'diamond-1', type: 'diamond', x: 0, y: 0, width: 90, height: 70,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor,
});
const line = (): WhiteboardElement => ({
  id: 'line-1', type: 'line', x: 0, y: 0, x2: 100, y2: 100,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1,
});
const textEl = (): WhiteboardElement => ({
  id: 'text-1', type: 'text', x: 0, y: 0, content: 'hi', fontSize: 20,
  fontFamily: 'sans-serif', color: '#000000', strokeColor: '#000000',
  strokeWidth: 1, opacity: 1, width: 24, height: 26,
});

/** 记录型 ctx stub（同 stroke-dash.test.ts 模式） */
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
const opNames = (calls: { op: string }[]) => calls.map((c) => c.op);

beforeEach(() => {
  useStore.setState({
    elements: [],
    selectedId: null,
    selectedIds: [],
    activeTool: 'select',
    fillColor: null,
    undoStack: [],
    redoStack: [],
    isDirty: false,
    fillGestureBefore: null,
  });
});

describe('canFillFromToolPanel / elementFillColor（谓词与回显）', () => {
  it('仅矩形/菱形/圆形可填充（画笔/文本/线/数学图不在范围）', () => {
    expect(canFillFromToolPanel(rect())).toBe(true);
    expect(canFillFromToolPanel(circleEl())).toBe(true);
    expect(canFillFromToolPanel(diamondEl())).toBe(true);
    expect(canFillFromToolPanel(line())).toBe(false);
    expect(canFillFromToolPanel(textEl())).toBe(false);
    expect(canFillFromToolPanel(null)).toBe(false);
  });

  it('elementFillColor：有填充读色，null / 旧文档缺字段读透明', () => {
    expect(elementFillColor(rect('#EF4444'))).toBe('#EF4444');
    expect(elementFillColor(rect(null))).toBeNull();
    const legacy = JSON.parse('{"id":"r","type":"rectangle","x":0,"y":0,"width":10,"height":10,"strokeColor":"#000","strokeWidth":2,"opacity":1}') as WhiteboardElement;
    expect(elementFillColor(legacy)).toBeNull();
    expect(elementFillColor(textEl())).toBeNull();
  });
});

describe('渲染顺序（fill 先于 stroke，选中框在其后由外层绘制）', () => {
  it('矩形：fillRect 在 strokeRect 之前（填充不盖描边）', () => {
    const { ctx, calls } = createMockCtx();
    renderElement(ctx, rect('#3B82F6'), VP);
    expect(opNames(calls)).toEqual(expect.arrayContaining(['fillRect', 'strokeRect']));
    expect(calls.findIndex((c) => c.op === 'fillRect')).toBeLessThan(calls.findIndex((c) => c.op === 'strokeRect'));
    expect(calls.find((c) => c.op === 'set:fillStyle')?.args).toEqual(['#3B82F6']);
  });

  it.each([
    ['circle-1', circleEl('#22C55E')],
    ['diamond-1', diamondEl('#F97316')],
  ] as const)('%s：fill() 在 stroke() 之前', (_id, element) => {
    const { ctx, calls } = createMockCtx();
    renderElement(ctx, element, VP);
    expect(calls.findIndex((c) => c.op === 'fill')).toBeLessThan(calls.findIndex((c) => c.op === 'stroke'));
  });

  it('无填充（null / 旧文档缺字段）：不产生 fill 调用（零回归）', () => {
    const legacy = JSON.parse('{"id":"r","type":"rectangle","x":0,"y":0,"width":10,"height":10,"strokeColor":"#000","strokeWidth":2,"opacity":1}') as WhiteboardElement;
    for (const target of [rect(), circleEl(), diamondEl(), legacy]) {
      const { ctx, calls } = createMockCtx();
      renderElement(ctx, target, VP);
      expect(calls.find((c) => c.op === 'fill' || c.op === 'fillRect')).toBeUndefined();
    }
  });
});

describe('SVG 导出与序列化', () => {
  it('三形状填充 → fill 色写入；无填充 → fill="none"', () => {
    const filled = exportToSvg([rect('#3B82F6'), circleEl('#22C55E'), diamondEl('#F97316')]);
    expect(filled).toContain('<rect ');
    expect((filled.match(/ fill="#3B82F6"/g) ?? []).length).toBe(1);
    expect((filled.match(/ fill="#22C55E"/g) ?? []).length).toBe(1);
    expect((filled.match(/ fill="#F97316"/g) ?? []).length).toBe(1);
    const plain = exportToSvg([rect(), circleEl(), diamondEl()]);
    expect((plain.match(/ fill="none"/g) ?? []).length).toBe(3);
  });

  it('fillColor JSON 往返：保存重开填充保持（localStorage / 服务端同通道）', () => {
    const round = JSON.parse(JSON.stringify(rect('#A855F7'))) as WhiteboardElement;
    expect(elementFillColor(round)).toBe('#A855F7');
    // 撤销快照同样只持元素引用，undo / redo 后填充随元素整体恢复
    useStore.setState({ elements: [round], selectedId: 'rect-1' });
    useStore.getState().pickFillColor(null);
    useStore.getState().undo();
    expect(elementFillColor(el('rect-1'))).toBe('#A855F7');
  });
});

describe('pickFillColor（选中改填充 / 新绘制默认）', () => {
  it('选中矩形选色 → fillColor 立即生效（PM 验收场景的数据侧）', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickFillColor('#EF4444');
    expect(elementFillColor(el('rect-1'))).toBe('#EF4444');
  });

  it.each([
    ['rect-1', rect()],
    ['circle-1', circleEl()],
    ['diamond-1', diamondEl()],
  ] as const)('%s：单条可撤销快照，undo 回透明、redo 恢复填充', (id, element) => {
    useStore.setState({ elements: [element], selectedId: id });
    useStore.getState().pickFillColor('#3B82F6');
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(elementFillColor(el(id))).toBeNull();
    useStore.getState().redo();
    expect(elementFillColor(el(id))).toBe('#3B82F6');
  });

  it('改色可再撤销：第二次改色 undo 回到前一色（历史正确交错）', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickFillColor('#EF4444');
    useStore.getState().pickFillColor('#22C55E');
    useStore.getState().undo();
    expect(elementFillColor(el('rect-1'))).toBe('#EF4444');
    useStore.getState().undo();
    expect(elementFillColor(el('rect-1'))).toBeNull();
  });

  it('清除填充（null）：回透明，同样可撤销', () => {
    useStore.setState({ elements: [rect('#EF4444')], selectedId: 'rect-1' });
    useStore.getState().pickFillColor(null);
    expect(elementFillColor(el('rect-1'))).toBeNull();
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(elementFillColor(el('rect-1'))).toBe('#EF4444');
  });

  it('同色再点不压栈（空转不污染历史）', () => {
    useStore.setState({ elements: [rect('#EF4444')], selectedId: 'rect-1' });
    useStore.getState().pickFillColor('#EF4444');
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('多选批量：矩形+圆+文本同选 → 仅两形状填充，一条快照整体撤销', () => {
    useStore.setState({
      elements: [rect(), circleEl(), textEl()],
      selectedIds: ['rect-1', 'circle-1', 'text-1'],
      selectedId: 'text-1',
    });
    useStore.getState().pickFillColor('#3B82F6');
    expect(elementFillColor(el('rect-1'))).toBe('#3B82F6');
    expect(elementFillColor(el('circle-1'))).toBe('#3B82F6');
    expect(el('text-1').type).toBe('text'); // 文本不被触碰
    expect('fillColor' in el('text-1')).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(elementFillColor(el('rect-1'))).toBeNull();
    expect(elementFillColor(el('circle-1'))).toBeNull();
  });

  it('无选中 → 仅设默认，不动元素、不压栈；默认随新形状携带', () => {
    useStore.setState({ elements: [rect()], selectedId: null, selectedIds: [] });
    useStore.getState().pickFillColor('#6366F1');
    expect(elementFillColor(el('rect-1'))).toBeNull();
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().fillColor).toBe('#6366F1');
  });

  it('选中时同步默认：切走选中后新建形状沿用刚选的填充色', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().pickFillColor('#EC4899');
    expect(useStore.getState().fillColor).toBe('#EC4899');
  });

  it('选中纯非形状（线/文本）→ 跳过元素，默认照常同步', () => {
    useStore.setState({ elements: [line(), textEl()], selectedIds: ['line-1', 'text-1'], selectedId: 'line-1' });
    useStore.getState().pickFillColor('#3B82F6');
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().fillColor).toBe('#3B82F6');
    expect('fillColor' in el('line-1')).toBe(false);
  });

  it('改动标记 isDirty（持久化通道）', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1', isDirty: false });
    useStore.getState().pickFillColor('#3B82F6');
    expect(useStore.getState().isDirty).toBe(true);
  });
});

describe('inputFillColor / commitFillStyle（取色器两段式，D5）', () => {
  it('拖动直改不入栈，失焦收尾压单条快照，undo 回原色', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().inputFillColor('#F97316');
    expect(elementFillColor(el('rect-1'))).toBe('#F97316');
    expect(useStore.getState().undoStack).toHaveLength(0);
    useStore.getState().inputFillColor('#EAB308');
    expect(useStore.getState().undoStack).toHaveLength(0);
    useStore.getState().commitFillStyle();
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(elementFillColor(el('rect-1'))).toBeNull();
    useStore.getState().redo();
    expect(elementFillColor(el('rect-1'))).toBe('#EAB308');
  });

  it('多选拖动：批量预览 + 单条快照整体撤销', () => {
    useStore.setState({
      elements: [rect(), circleEl(), diamondEl()],
      selectedIds: ['rect-1', 'circle-1', 'diamond-1'],
      selectedId: 'diamond-1',
    });
    useStore.getState().inputFillColor('#14B8A6');
    for (const id of ['rect-1', 'circle-1', 'diamond-1']) expect(elementFillColor(el(id))).toBe('#14B8A6');
    expect(useStore.getState().undoStack).toHaveLength(0);
    useStore.getState().commitFillStyle();
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    for (const id of ['rect-1', 'circle-1', 'diamond-1']) expect(elementFillColor(el(id))).toBeNull();
  });

  it('收尾无改动不压栈；无选中仅同步默认（直改通道不触碰元素）', () => {
    useStore.setState({ elements: [rect()], selectedId: 'rect-1' });
    useStore.getState().inputFillColor('#3B82F6');
    useStore.getState().pickFillColor('#3B82F6'); // 已是同色，直改后收尾应空转
    useStore.getState().commitFillStyle();
    expect(useStore.getState().undoStack).toHaveLength(1); // 仅 pickFillColor 一条

    useStore.setState({ selectedId: null, selectedIds: [], undoStack: [], fillGestureBefore: null });
    useStore.getState().inputFillColor('#A855F7');
    expect(elementFillColor(el('rect-1'))).toBe('#3B82F6');
    expect(useStore.getState().fillColor).toBe('#A855F7');
    useStore.getState().commitFillStyle();
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
