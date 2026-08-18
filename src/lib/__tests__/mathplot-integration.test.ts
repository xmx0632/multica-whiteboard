/**
 * MathPlot 元素集成测试（ZOO-136，技术方案 §5.3 兼容性核对表 + PR5 完成定义）：
 * - 元素工厂（创建落点 / 几何定义域 / 错误占位）；
 * - 渲染管线接入（renderElement case、culling、选中框 8 控点、控点命中）；
 * - 前向兼容：未知类型静默忽略（不绘制 / bounds null / hitTest false）；
 * - store 增删改 / updateElementTransient 不入栈 / 撤销重做；
 * - SVG 导出 case（曲线 path / 网格 / 标签 / 错误态）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import {
  DEFAULT_MATHPLOT,
  MathPlotElement,
  WhiteboardElement,
} from '../types';
import {
  createMathPlotElement,
  mathPlotFieldsFromPayload,
} from '../mathplotElement';
import {
  getElementBounds,
  hitTest,
  hitTestSelectionHandle,
  renderElement,
  renderSelection,
} from '../renderer';
import { exportToSvg } from '../export';
import type { EquationDraftPayload, StructuralOutcome } from '../math/types';
import { plotTokenFor, plotRenderWriteCount } from '../math/cache';
import { resolvePlotRender } from '../math/plot';

const VP = { offsetX: 0, offsetY: 0, scale: 1 };

function makeElement(overrides: Partial<MathPlotElement> = {}): MathPlotElement {
  return {
    id: 'mp-1',
    type: 'mathPlot',
    x: 100,
    y: 80,
    width: 480,
    height: 360,
    strokeColor: '#3B82F6',
    strokeWidth: 2,
    opacity: 1,
    equation: 'y=sin(x)',
    kind: 'explicit',
    error: null,
    xAxis: { min: -10, max: 10 },
    equalRatio: true,
    sampleCount: 320,
    showAxis: true,
    showGrid: true,
    showLabel: true,
    ...overrides,
  };
}

/** 记录型 ctx stub（无 Path2D 环境下 renderElement 仍走折线回退）。 */
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

beforeEach(() => {
  useStore.setState({
    elements: [],
    selectedId: null,
    activeTool: 'pen',
    undoStack: [],
    redoStack: [],
    isDirty: false,
    pendingMathPlot: null,
  });
});

describe('元素工厂（创建落点与分类）', () => {
  const explicit: EquationDraftPayload = { equation: 'y=sin(x)', outcome: { kind: 'explicit' } };

  it('显式函数：中心落点、默认尺寸与工具栏样式继承', () => {
    const el = createMathPlotElement(explicit, {
      centerX: 500, centerY: 400, strokeColor: '#EF4444', strokeWidth: 5,
    });
    expect(el.type).toBe('mathPlot');
    expect(el.kind).toBe('explicit');
    expect(el.error).toBeNull();
    expect(el.width).toBe(DEFAULT_MATHPLOT.width);
    expect(el.height).toBe(DEFAULT_MATHPLOT.height);
    expect(el.x).toBeCloseTo(500 - DEFAULT_MATHPLOT.width / 2);
    expect(el.y).toBeCloseTo(400 - DEFAULT_MATHPLOT.height / 2);
    expect(el.strokeColor).toBe('#EF4444');
    expect(el.strokeWidth).toBe(5);
    expect(el.sampleCount).toBe(320);
    expect(el.showAxis && el.showGrid && el.showLabel).toBe(true);
  });

  it('可视区约束：默认尺寸超出时等比收缩', () => {
    const el = createMathPlotElement(explicit, { centerX: 0, centerY: 0, maxWidth: 240, maxHeight: 180 });
    expect(el.width).toBeCloseTo(240);
    expect(el.height).toBeCloseTo(180);
  });

  it('几何方程：equalRatio 强制 true、定义域取采样包围盒', () => {
    const circle: EquationDraftPayload = {
      equation: '(x-1)²+(y-2)²=9',
      outcome: { kind: 'circle', params: { cx: 1, cy: 2, r: 3 } },
    };
    const el = createMathPlotElement(circle, { centerX: 0, centerY: 0 });
    expect(el.kind).toBe('circle');
    expect(el.equalRatio).toBe(true);
    expect(el.xAxis.min).toBeLessThan(-2); // cx-r-留边
    expect(el.xAxis.max).toBeGreaterThan(4);
  });

  it('错误载荷：同样建元素（原型决策 4），kind/error 承载原因', () => {
    const bad: EquationDraftPayload = {
      equation: 'y=#',
      outcome: { kind: 'error', message: '无法识别的符号 “#”' },
    };
    const el = createMathPlotElement(bad, { centerX: 0, centerY: 0 });
    expect(el.kind).toBe('error');
    expect(el.error).toBe('无法识别的符号 “#”');
  });

  it('原位替换补丁：只动数学字段，样式 / 位置由调用方保留', () => {
    const patch = mathPlotFieldsFromPayload({ equation: 'y=cos(x)', outcome: { kind: 'explicit' } });
    expect(patch).toEqual({ equation: 'y=cos(x)', kind: 'explicit', error: null });
  });
});

describe('渲染管线接入', () => {
  it('renderElement 正常绘制（translate 到元素位置）', () => {
    const { ctx, calls } = createMockCtx();
    renderElement(ctx, makeElement(), VP);
    const translate = calls.find((c) => c.op === 'translate');
    expect(translate).toBeDefined();
    expect(translate!.args[0]).toBeCloseTo(100);
    expect(translate!.args[1]).toBeCloseTo(80);
  });

  it('包围盒 = 外框（hitTest 零改动命中）', () => {
    const el = makeElement();
    expect(getElementBounds(el)).toEqual({ x: 100, y: 80, width: 480, height: 360 });
    expect(hitTest(el, { x: 200, y: 200 }, VP)).toBe(true);
    expect(hitTest(el, { x: 50, y: 50 }, VP)).toBe(false);
  });

  it('选中框：mathPlot 8 控点，rectangle 维持 4 控点（D-1 零回归）', () => {
    const rect = {
      id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50,
      strokeColor: '#000', strokeWidth: 2, opacity: 1, fillColor: null,
    } as WhiteboardElement;
    const a = createMockCtx();
    renderSelection(a.ctx, rect, VP);
    expect(a.calls.filter((c) => c.op === 'fillRect')).toHaveLength(4);

    const b = createMockCtx();
    renderSelection(b.ctx, makeElement(), VP);
    expect(b.calls.filter((c) => c.op === 'fillRect')).toHaveLength(8);
  });

  it('控点命中：mathPlot 角 / 边可命中，其他元素返回 null', () => {
    const el = makeElement();
    // 外框 (100,80)-(580,440)，选中框外扩 4px → se 角控点 ≈ (576,436)
    expect(hitTestSelectionHandle(el, { x: 578, y: 438 }, VP)).toBe('se');
    expect(hitTestSelectionHandle(el, { x: 100, y: 438 }, VP)).toBe('sw');
    // 东边中点控点 ≈ x=580, y=(76+444)/2=260
    expect(hitTestSelectionHandle(el, { x: 578, y: 260 }, VP)).toBe('e');
    expect(hitTestSelectionHandle(el, { x: 300, y: 260 }, VP)).toBeNull();

    const rect = {
      id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50,
      strokeColor: '#000', strokeWidth: 2, opacity: 1, fillColor: null,
    } as WhiteboardElement;
    expect(hitTestSelectionHandle(rect, { x: 0, y: 0 }, VP)).toBeNull();
  });

  it('渲染缓存：同 id 换对象引用（拖拽移动 / 调参）不重算（§6.3）', () => {
    const el = makeElement({ id: 'mp-cache-fresh' }); // 独立 id，避免命中先行测试的缓存
    const spec = {
      equation: el.equation, kind: el.kind, xAxis: el.xAxis,
      equalRatio: el.equalRatio, sampleCount: el.sampleCount,
    };
    const frame = { width: el.width, height: el.height };
    const before = plotRenderWriteCount();
    resolvePlotRender(spec, frame, plotTokenFor(el.id));
    expect(plotRenderWriteCount()).toBe(before + 1);
    // 模拟 store 不可变更新：同 id 新对象引用 → 命中，无重算
    resolvePlotRender(spec, frame, plotTokenFor(el.id));
    expect(plotRenderWriteCount()).toBe(before + 1);
    // 样式不在签名中：改颜色 / 线宽同样命中
    resolvePlotRender(spec, frame, plotTokenFor(el.id));
    expect(plotRenderWriteCount()).toBe(before + 1);
  });
});

describe('前向兼容（旧版开新文档：未知类型静默忽略）', () => {
  const unknownEl = { id: 'x', type: 'sticker', x: 0, y: 0, strokeColor: '#000', strokeWidth: 1, opacity: 1 } as unknown as WhiteboardElement;

  it('renderElement 无匹配即不绘制、bounds 为 null、hitTest false', () => {
    const { ctx, calls } = createMockCtx();
    expect(() => renderElement(ctx, unknownEl, VP)).not.toThrow();
    expect(calls).toHaveLength(0);
    expect(getElementBounds(unknownEl)).toBeNull();
    expect(hitTest(unknownEl, { x: 0, y: 0 }, VP)).toBe(false);
  });
});

describe('store 全链路（增删改 / 选中 / 撤销重做 / 直改）', () => {
  it('addElement + deleteElement + undo/redo', () => {
    const el = makeElement();
    useStore.getState().addElement(el);
    expect(useStore.getState().elements).toHaveLength(1);
    expect(useStore.getState().isDirty).toBe(true);

    useStore.getState().undo();
    expect(useStore.getState().elements).toHaveLength(0);
    useStore.getState().redo();
    expect(useStore.getState().elements).toHaveLength(1);
    expect((useStore.getState().elements[0] as MathPlotElement).equation).toBe('y=sin(x)');

    useStore.getState().setSelected(el.id);
    useStore.getState().deleteElement(el.id);
    expect(useStore.getState().elements).toHaveLength(0);
    expect(useStore.getState().selectedId).toBeNull();
    useStore.getState().undo();
    expect(useStore.getState().elements).toHaveLength(1);
  });

  it('updateElementTransient：直改且不入撤销栈（D5）', () => {
    const el = makeElement();
    useStore.getState().addElement(el);
    const undoDepth = useStore.getState().undoStack.length;

    useStore.getState().updateElementTransient(el.id, { strokeColor: '#22C55E' } as Partial<WhiteboardElement>);
    expect((useStore.getState().elements[0] as MathPlotElement).strokeColor).toBe('#22C55E');
    expect(useStore.getState().undoStack.length).toBe(undoDepth); // 不入栈

    // 提交方压一条快照 → 一次撤销回到手势前
    const after = useStore.getState().elements[0];
    useStore.getState().pushOperations([{ type: 'update', elementId: el.id, before: el, after }]);
    useStore.getState().undo();
    expect((useStore.getState().elements[0] as MathPlotElement).strokeColor).toBe('#3B82F6');
  });

  it('updateElement 数学字段原位替换（错误占位 → 修正）可撤销', () => {
    const el = makeElement({ kind: 'error', error: '无法识别的方程', equation: 'y=#' });
    useStore.getState().addElement(el);
    useStore.getState().updateElement(el.id, mathPlotFieldsFromPayload({
      equation: 'y=sin(x)',
      outcome: { kind: 'explicit' } as StructuralOutcome,
    }) as Partial<WhiteboardElement>);
    const now = useStore.getState().elements[0] as MathPlotElement;
    expect(now.kind).toBe('explicit');
    expect(now.error).toBeNull();
    useStore.getState().undo();
    expect((useStore.getState().elements[0] as MathPlotElement).kind).toBe('error');
  });

  it('插入握手：request → pending，consume → 清空', () => {
    useStore.getState().requestMathPlotInsert({ equation: 'y=x', outcome: { kind: 'explicit' } });
    expect(useStore.getState().pendingMathPlot?.payload.equation).toBe('y=x');
    expect(useStore.getState().pendingMathPlot?.strokeColor).toBe(useStore.getState().strokeColor);
    useStore.getState().consumeMathPlotInsert();
    expect(useStore.getState().pendingMathPlot).toBeNull();
  });
});

describe('导出（PNG 复用 renderElement / SVG 增量 case）', () => {
  it('SVG：曲线 path + 网格 + 轴 + 方程标签 chip', () => {
    const svg = exportToSvg([makeElement()]);
    expect(svg).toContain('<path');
    expect(svg).toContain('<line');
    expect(svg).toContain('y=sin(x)'); // 标签为美化文本（beautifyEquation 对本式无改写）
    expect(svg).toContain('stroke="#3B82F6"');
    expect(svg).not.toContain('undefined');
  });

  it('SVG：错误态为虚线占位框 + 原因文案', () => {
    const svg = exportToSvg([makeElement({ kind: 'error', error: '无法识别的符号', equation: 'y=#' })]);
    expect(svg).toContain('stroke-dasharray="6,4"');
    expect(svg).toContain('无法识别的符号');
    expect(svg).not.toContain('<path d="M'); // 无曲线
  });

  it('SVG：显隐开关受控（关网格 / 轴 / 标签）', () => {
    const svg = exportToSvg([makeElement({ showGrid: false, showAxis: false, showLabel: false })]);
    expect(svg).not.toMatch(/<line[^>]*#e5e7eb/); // 无网格线（卡片边框同色不受影响）
    expect(svg).not.toMatch(/<line[^>]*#9ca3af/); // 无轴线
    expect(svg).not.toContain('font-family="serif"'); // 无方程 chip 文本
  });
});
