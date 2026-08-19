/**
 * 文本工具单测（ZOO-159）：
 * - measureTextElement：多行实度量（最长行宽 / 行数 × 1.3 行高），替换字符数粗估；
 * - createTextElement：T 工具内联输入确认落元素（宽高实度量，color 与 strokeColor 同源）；
 * - textContentPatch：双击编辑确认 → 内容更新 + 宽高重测（store updateElement 可撤销）；
 * - textResizePatch：角控点等比缩放 —— fontSize 随外框比例、nw 锚定对角、字号下限兜底；
 * - inputFontSize：选中文字字号滑杆 D5 两段式（拖动直改不入栈、收尾一条快照）。
 *
 * 度量器注入假实现（字符数 × 10px）使宽度断言确定；store 路径走 node 退化度量
 * （字符数 × fontSize × 0.6，同旧粗估口径）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { TextElement } from '../types';
import {
  createTextElement,
  measureTextElement,
  textContentPatch,
  textResizePatch,
  textFont,
  TextWidthMeasurer,
} from '../textElement';

// 假度量器：宽度 = 字符数 × 10px（与字号无关，断言可预测）
const measurer: TextWidthMeasurer = (text) => text.length * 10;

const el = (id: string) =>
  useStore.getState().elements.find((e) => e.id === id) as TextElement;

beforeEach(() => {
  useStore.setState({
    elements: [],
    selectedId: null,
    activeTool: 'select',
    fontSize: 20,
    strokeColor: '#000000',
    undoStack: [],
    redoStack: [],
    isDirty: false,
    strokeGestureBefore: null,
  });
});

describe('measureTextElement（实度量替换字符数粗估）', () => {
  it('单行：宽 = 行宽，高 = fontSize × 1.3', () => {
    expect(measureTextElement({ content: 'hello', fontSize: 20, fontFamily: 'sans-serif' }, measurer))
      .toEqual({ width: 50, height: 26 });
  });

  it('多行：宽取最长行，高按行数累加', () => {
    expect(measureTextElement({ content: 'hello\nhi\nhey', fontSize: 20, fontFamily: 'sans-serif' }, measurer))
      .toEqual({ width: 50, height: 78 });
  });

  it('空串：宽 0 高一行（空草稿不产生幻影包围盒宽度）', () => {
    expect(measureTextElement({ content: '', fontSize: 20, fontFamily: 'sans-serif' }, measurer))
      .toEqual({ width: 0, height: 26 });
  });

  it('textFont 与 drawText 的 ctx.font 同构（默认字体兜底）', () => {
    expect(textFont(20, 'sans-serif')).toBe('20px sans-serif');
    expect(textFont(14, '')).toBe('14px sans-serif');
  });
});

describe('createTextElement（T 工具内联输入确认落元素）', () => {
  it('宽高实度量，color 与 strokeColor 同源', () => {
    const created = createTextElement(
      { x: 30, y: 40, content: 'hi', fontSize: 20, color: '#EF4444' },
      measurer
    );
    expect(created).toMatchObject({
      type: 'text', x: 30, y: 40, content: 'hi', fontSize: 20,
      color: '#EF4444', strokeColor: '#EF4444',
      width: 20, height: 26, opacity: 1,
    });
  });

  it('落元素经 addElement 入撤销栈：Ctrl+Z 语义整体移除', () => {
    const created = createTextElement(
      { x: 0, y: 0, content: 'hi', fontSize: 20, color: '#000000' },
      measurer
    );
    useStore.getState().addElement(created);
    expect(useStore.getState().elements).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().elements).toHaveLength(0);
  });
});

describe('textContentPatch（双击编辑确认 → 内容 + 实度量宽高）', () => {
  it('内容变更同步重测宽高（改长文本外框变大），updateElement 单条快照可撤销', () => {
    const original = createTextElement(
      { x: 0, y: 0, content: 'hi', fontSize: 20, color: '#000000' },
      measurer
    );
    useStore.getState().addElement(original);
    useStore.getState().updateElement(original.id, textContentPatch(original, 'hello\nworld', measurer));
    const cur = el(original.id);
    expect(cur.content).toBe('hello\nworld');
    expect(cur.width).toBe(50);   // 最长行 5 字符 × 10
    expect(cur.height).toBe(52);  // 2 行 × 20 × 1.3
    // 撤销栈：create + update 各一条
    expect(useStore.getState().undoStack).toHaveLength(2);
    useStore.getState().undo(); // 回退编辑 → 内容与宽高回旧值（元素仍在）
    expect(el(original.id).content).toBe('hi');
    expect(el(original.id).width).toBe(20);
  });
});

describe('textResizePatch（角控点等比缩放改字号）', () => {
  // x=100 y=50 w=80 h=52 fontSize=40：右缘 180 / 下缘 102
  const base = (): TextElement => ({
    id: 't1', type: 'text', x: 100, y: 50, content: 'hi', fontSize: 40,
    fontFamily: 'sans-serif', color: '#000000', strokeColor: '#000000',
    strokeWidth: 1, opacity: 1, width: 80, height: 52,
  });

  it('se 控点拖大：fontSize 随外框比例放大，宽高同步，左上角锚定不动', () => {
    const next = textResizePatch('se', base(), { x: 260, y: 180 });
    // 主导轴比例 2.5（130/52）：40 → 100，外框同乘 2.5
    expect(next.fontSize).toBe(100);
    expect(next.width).toBe(200);
    expect(next.height).toBe(130);
    expect(next.x).toBe(100);
    expect(next.y).toBe(50);
  });

  it('nw 控点拖大：锚定右下角（x/y 随缩放左上回退）', () => {
    const next = textResizePatch('nw', base(), { x: 20, y: 0 });
    // 宽向比例 2（160/80）为主导：fontSize 80，右下角 (180,102) 保持
    expect(next.fontSize).toBe(80);
    expect(next.width).toBe(160);
    expect(next.x).toBe(20);    // 180 - 160
    expect(next.y).toBe(-2);    // 102 - 104
  });

  it('拖过头：字号下限 10px 兜底，外框按下限字号比例自洽（小字号不配大外框）', () => {
    const next = textResizePatch('se', base(), { x: 110, y: 70 });
    expect(next.fontSize).toBe(10);
    const applied = 10 / 40;
    expect(next.width).toBe(80 * applied);
    expect(next.height).toBe(52 * applied);
  });

  it('缩放补丁经 transient + 一条 update 快照提交：undo 回退字号与外框（抬指提交语义）', () => {
    const original = base();
    original.id = 'scale-1';
    useStore.getState().addElement(original);
    useStore.setState({ undoStack: [] }); // 隔离 create 快照，只观察缩放手势
    const patch = textResizePatch('se', original, { x: 260, y: 180 });
    useStore.getState().updateElementTransient(original.id, patch);
    expect(useStore.getState().undoStack).toHaveLength(0); // 拖动过程不入栈
    useStore.getState().pushOperations([{
      type: 'update', elementId: original.id,
      before: original, after: { ...el(original.id) },
    }]);
    expect(el(original.id).fontSize).toBe(100);
    useStore.getState().undo();
    expect(el(original.id).fontSize).toBe(40);
    expect(el(original.id).width).toBe(80);
  });
});

describe('inputFontSize（选中文字字号滑杆，D5 两段式）', () => {
  const text = (): TextElement => ({
    id: 'fs-1', type: 'text', x: 0, y: 0, content: 'hi', fontSize: 20,
    fontFamily: 'sans-serif', color: '#000000', strokeColor: '#000000',
    strokeWidth: 1, opacity: 1, width: 24, height: 26,
  });

  it('选中 text：拖动直改 fontSize 并重测宽高（不入栈），默认字号同步', () => {
    useStore.setState({ elements: [text()], selectedId: 'fs-1' });
    useStore.getState().inputFontSize(36);
    expect(useStore.getState().undoStack).toHaveLength(0);
    const cur = el('fs-1');
    expect(cur.fontSize).toBe(36);
    // node 退化度量：2 字符 × 36 × 0.6
    expect(cur.width).toBeCloseTo(43.2, 6);
    expect(cur.height).toBeCloseTo(46.8, 6);
    expect(useStore.getState().fontSize).toBe(36);
  });

  it('一次拖动多次 input → commitStrokeStyle 只压一条快照，undo 回退字号与宽高', () => {
    useStore.setState({ elements: [text()], selectedId: 'fs-1' });
    useStore.getState().inputFontSize(30);
    useStore.getState().inputFontSize(42);
    useStore.getState().commitStrokeStyle();
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    const back = el('fs-1');
    expect(back.fontSize).toBe(20);
    expect(back.width).toBe(24);
    expect(back.height).toBe(26);
  });

  it('无选中 / 选中非 text：仅设默认字号，元素不动、收尾不压栈', () => {
    useStore.setState({ elements: [text()], selectedId: null });
    useStore.getState().inputFontSize(50);
    useStore.getState().commitStrokeStyle();
    expect(el('fs-1').fontSize).toBe(20);
    expect(useStore.getState().fontSize).toBe(50);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('选中矩形（非 text）：滑杆不改其样式，仅同步默认字号', () => {
    useStore.setState({
      elements: [{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, strokeColor: '#000000', strokeWidth: 2, opacity: 1, fillColor: null }],
      selectedId: 'r1',
    });
    useStore.getState().inputFontSize(60);
    useStore.getState().commitStrokeStyle();
    expect(useStore.getState().fontSize).toBe(60);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
