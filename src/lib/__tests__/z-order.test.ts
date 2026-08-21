/**
 * 图层顺序调整单测（ZOO-183）：
 * - reorderElements / zOrderBounds 纯函数：四向重排、边界空转、引用不变；
 * - store 四 action：数组重排即时生效、isDirty 置脏、单条可撤销快照；
 * - 边界一致（已在顶 / 底层）：不置脏、不压栈、不报错；
 * - undo / redo：层级精确回退 / 重做，并与 create（画笔）/ update / delete 历史正确交错。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { WhiteboardElement, MathPlotElement } from '../types';
import { reorderElements, zOrderBounds } from '../zorder';

const rect = (id: string): WhiteboardElement => ({
  id, type: 'rectangle', x: 0, y: 0, width: 100, height: 60,
  strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null,
});

const mathPlot = (id: string): MathPlotElement => ({
  id, type: 'mathPlot', x: 0, y: 0, width: 480, height: 360,
  strokeColor: '#3B82F6', strokeWidth: 2, opacity: 1,
  equation: 'y=sin(x)', kind: 'explicit', error: null,
  xAxis: { min: -10, max: 10 }, equalRatio: true, sampleCount: 320,
  showAxis: true, showGrid: true, showLabel: true,
});

const textEl = (id: string): WhiteboardElement => ({
  id, type: 'text', x: 0, y: 0, content: 'hi', fontSize: 20,
  fontFamily: 'sans-serif', color: '#000000', strokeColor: '#000000',
  strokeWidth: 1, opacity: 1, width: 24, height: 26,
});

const ids = () => useStore.getState().elements.map((e) => e.id);

beforeEach(() => {
  useStore.setState({
    elements: [rect('a'), rect('b'), rect('c')],
    selectedId: null,
    undoStack: [],
    redoStack: [],
    isDirty: false,
  });
});

describe('reorderElements（纯函数）', () => {
  const els = [rect('a'), rect('b'), rect('c')];

  it('bringToFront：中间元素移到末位（最上层）', () => {
    expect(reorderElements(els, 'a', 'bringToFront')!.map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('sendToBack：中间元素移到首位（最底层）', () => {
    expect(reorderElements(els, 'c', 'sendToBack')!.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('bringForward / sendBackward：与相邻一层交换', () => {
    expect(reorderElements(els, 'a', 'bringForward')!.map((e) => e.id)).toEqual(['b', 'a', 'c']);
    expect(reorderElements(els, 'c', 'sendBackward')!.map((e) => e.id)).toEqual(['a', 'c', 'b']);
  });

  it('边界空转返回 null：顶层 bringToFront / forward，底层 sendToBack / backward', () => {
    expect(reorderElements(els, 'c', 'bringToFront')).toBeNull();
    expect(reorderElements(els, 'c', 'bringForward')).toBeNull();
    expect(reorderElements(els, 'a', 'sendToBack')).toBeNull();
    expect(reorderElements(els, 'a', 'sendBackward')).toBeNull();
  });

  it('无选中 / 元素不存在返回 null；原数组不动、元素对象引用复用', () => {
    expect(reorderElements(els, null, 'bringToFront')).toBeNull();
    expect(reorderElements(els, 'nope', 'sendToBack')).toBeNull();
    const out = reorderElements(els, 'a', 'bringToFront')!;
    expect(els.map((e) => e.id)).toEqual(['a', 'b', 'c']); // 原数组不变
    expect(out).toHaveLength(3);
    expect(out.every((e) => els.includes(e))).toBe(true); // 同一对象集，仅换位
  });
});

describe('zOrderBounds（面板置灰判定）', () => {
  it('首位 atBack、末位 atFront；中间两者皆否', () => {
    const els = [rect('a'), rect('b'), rect('c')];
    expect(zOrderBounds(els, 'a')).toEqual({ atFront: false, atBack: true });
    expect(zOrderBounds(els, 'b')).toEqual({ atFront: false, atBack: false });
    expect(zOrderBounds(els, 'c')).toEqual({ atFront: true, atBack: false });
  });

  it('单元素四向全边界；无选中 / 不存在不判边界', () => {
    const single = [rect('only')];
    expect(zOrderBounds(single, 'only')).toEqual({ atFront: true, atBack: true });
    expect(zOrderBounds(single, null)).toEqual({ atFront: false, atBack: false });
  });
});

describe('store 四 action（数组重排 + 历史语义）', () => {
  it('moveUp：选中 a 上移一层，渲染顺序即时更新', () => {
    useStore.setState({ selectedId: 'a' });
    useStore.getState().moveUp();
    expect(ids()).toEqual(['b', 'a', 'c']);
  });

  it('moveDown：选中 c 下移一层', () => {
    useStore.setState({ selectedId: 'c' });
    useStore.getState().moveDown();
    expect(ids()).toEqual(['a', 'c', 'b']);
  });

  it('bringToFront / sendToBack：整体置顶 / 置底', () => {
    useStore.setState({ selectedId: 'a' });
    useStore.getState().bringToFront();
    expect(ids()).toEqual(['b', 'c', 'a']);
    useStore.getState().sendToBack();
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('每次调整压一条快照并置脏（持久化通道）；选中保持不变', () => {
    useStore.setState({ selectedId: 'a' });
    useStore.getState().moveUp();
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().isDirty).toBe(true);
    expect(useStore.getState().selectedId).toBe('a');
  });

  it('mathPlot 一视同仁：选中数学图形同样可调层级', () => {
    useStore.setState({ elements: [rect('a'), mathPlot('mp')], selectedId: 'mp' });
    useStore.getState().sendToBack();
    expect(ids()).toEqual(['mp', 'a']);
  });

  it('text 一视同仁：文本元素同样参与层级调整', () => {
    useStore.setState({ elements: [rect('a'), textEl('t'), rect('c')], selectedId: 't' });
    useStore.getState().bringToFront();
    expect(ids()).toEqual(['a', 'c', 't']);
  });

  it('边界空转：不置脏、不压栈、顺序不变（与按钮置灰双保险）', () => {
    useStore.setState({ selectedId: 'c' }); // 已在最上层
    useStore.getState().bringToFront();
    useStore.getState().moveUp();
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().isDirty).toBe(false);
    useStore.setState({ selectedId: 'a' }); // 已在最底层
    useStore.getState().sendToBack();
    useStore.getState().moveDown();
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().isDirty).toBe(false);
  });

  it('无选中：四操作全部空转', () => {
    useStore.getState().bringToFront();
    useStore.getState().sendToBack();
    useStore.getState().moveUp();
    useStore.getState().moveDown();
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

describe('撤销 / 重做（与既有操作历史正确交错）', () => {
  it('undo 恢复调整前层级，redo 重新应用', () => {
    useStore.setState({ selectedId: 'a' });
    useStore.getState().moveUp(); // [b,a,c]
    expect(ids()).toEqual(['b', 'a', 'c']);
    useStore.getState().undo();
    expect(ids()).toEqual(['a', 'b', 'c']);
    useStore.getState().redo();
    expect(ids()).toEqual(['b', 'a', 'c']);
  });

  it('与 create（画笔）交错：新建 → 调层级 → 两次 undo / 两次 redo 逐步还原', () => {
    useStore.getState().addElement(rect('d')); // [a,b,c,d]
    useStore.setState({ selectedId: 'a' });
    useStore.getState().bringToFront(); // [b,c,d,a]
    expect(ids()).toEqual(['b', 'c', 'd', 'a']);
    useStore.getState().undo(); // 撤销重排
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
    useStore.getState().undo(); // 撤销新建
    expect(ids()).toEqual(['a', 'b', 'c']);
    useStore.getState().redo(); // 重做新建（push 到末位）
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
    useStore.getState().redo(); // 重做重排
    expect(ids()).toEqual(['b', 'c', 'd', 'a']);
  });

  it('与 update 交错：改色与调层级各自独立撤销（元素属性不因重排丢失）', () => {
    useStore.setState({ selectedId: 'a' });
    useStore.getState().pickStrokeColor('#EF4444'); // update a 颜色
    useStore.getState().bringToFront(); // [b,c,a]
    useStore.getState().undo(); // 撤销重排 → [a,b,c]，颜色保持红
    const a = useStore.getState().elements.find((e) => e.id === 'a')!;
    expect(a.strokeColor).toBe('#EF4444');
    useStore.getState().undo(); // 撤销改色 → 黑
    expect(useStore.getState().elements.find((e) => e.id === 'a')!.strokeColor).toBe('#000000');
    useStore.getState().redo();
    useStore.getState().redo();
    expect(ids()).toEqual(['b', 'c', 'a']);
    expect(useStore.getState().elements.find((e) => e.id === 'a')!.strokeColor).toBe('#EF4444');
  });

  it('与 delete 交错：删元素 → 撤销删除回末位 → 撤销重排恢复原序', () => {
    useStore.setState({ selectedId: 'a' });
    useStore.getState().moveUp(); // [b,a,c]
    useStore.getState().deleteElement('c'); // [b,a]
    useStore.getState().undo(); // 删除撤销：c 回末位 [b,a,c]
    expect(ids()).toEqual(['b', 'a', 'c']);
    useStore.getState().undo(); // 重排撤销
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('中间操作清空 redoStack（同其他操作语义）', () => {
    useStore.setState({ selectedId: 'a' });
    useStore.getState().moveUp();
    useStore.getState().undo();
    expect(useStore.getState().redoStack).toHaveLength(1);
    useStore.setState({ selectedId: 'b' });
    useStore.getState().moveDown();
    expect(useStore.getState().redoStack).toHaveLength(0);
  });
});

describe('持久化往返（调整层级 → 保存 → 重新打开，层级保持）', () => {
  it('elements 数组顺序即层级：JSON 往返后顺序不变', () => {
    useStore.setState({ selectedId: 'b' });
    useStore.getState().bringToFront(); // [a,c,b]
    expect(ids()).toEqual(['a', 'c', 'b']);
    const round = JSON.parse(JSON.stringify(useStore.getState().elements)) as WhiteboardElement[];
    expect(round.map((e) => e.id)).toEqual(['a', 'c', 'b']);
  });

  it('loadDocument 重开文档：层级与保存时一致', () => {
    useStore.setState({ selectedId: 'b' });
    useStore.getState().bringToFront(); // [a,c,b]
    const saved = {
      id: 'doc-1', title: 'z-order', viewport: { offsetX: 0, offsetY: 0, scale: 1 },
      elements: JSON.parse(JSON.stringify(useStore.getState().elements)) as WhiteboardElement[],
      createdAt: 1, updatedAt: 2,
    };
    useStore.setState({ elements: [rect('x')], selectedId: null, undoStack: [], redoStack: [] });
    useStore.getState().loadDocument(saved);
    expect(ids()).toEqual(['a', 'c', 'b']);
  });
});
