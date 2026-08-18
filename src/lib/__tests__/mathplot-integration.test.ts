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

  it('二元一次方程（ZOO-146 / D7）：kind=line、equalRatio 强制、定义域取采样视窗', () => {
    const line: EquationDraftPayload = {
      equation: '3x+2y=6',
      outcome: { kind: 'line', params: { a: 3, b: 2, c: 6 } },
    };
    const el = createMathPlotElement(line, { centerX: 0, centerY: 0 });
    expect(el.kind).toBe('line');
    expect(el.error).toBeNull();
    expect(el.equalRatio).toBe(true);
    expect(el.xAxis.min).toBeLessThan(0); // 原点居中方形视窗（含坐标轴上下文）
    expect(el.xAxis.max).toBeGreaterThan(2); // x 截距可见
  });

  it('抛物线 / 双曲线（ZOO-147 / D7）：kind、equalRatio 强制、定义域取采样视窗', () => {
    const parabola: EquationDraftPayload = {
      equation: 'y²=4x',
      outcome: { kind: 'parabola', params: { h: 0, k: 0, p: 1, axis: 'x' } },
    };
    const pel = createMathPlotElement(parabola, { centerX: 0, centerY: 0 });
    expect(pel.kind).toBe('parabola');
    expect(pel.error).toBeNull();
    expect(pel.equalRatio).toBe(true);
    expect(pel.xAxis.min).toBeLessThanOrEqual(0); // 顶点可见
    expect(pel.xAxis.max).toBeGreaterThanOrEqual(1); // 焦点可见

    const hyperbola: EquationDraftPayload = {
      equation: '9x²-16y²=144',
      outcome: { kind: 'hyperbola', params: { h: 0, k: 0, a: 4, b: 3, axis: 'x' } },
    };
    const hel = createMathPlotElement(hyperbola, { centerX: 0, centerY: 0 });
    expect(hel.kind).toBe('hyperbola');
    expect(hel.equalRatio).toBe(true);
    expect(hel.xAxis.max).toBeGreaterThanOrEqual(5); // 焦点 (±5,0) 可见
    expect(hel.xAxis.min).toBeLessThanOrEqual(-5);
  });

  it('退化形（ZOO-148 / D7）：linePair / point 建元素、equalRatio 强制、定义域取采样视窗', () => {
    const pair: EquationDraftPayload = {
      equation: 'x²-y²=0',
      outcome: {
        kind: 'linePair',
        params: {
          lines: [
            { a: 1, b: -1, c: 0 },
            { a: 1, b: 1, c: 0 },
          ],
          mode: 'intersecting',
        },
      },
    };
    const pairEl = createMathPlotElement(pair, { centerX: 0, centerY: 0 });
    expect(pairEl.kind).toBe('linePair');
    expect(pairEl.error).toBeNull();
    expect(pairEl.equalRatio).toBe(true);
    expect(pairEl.xAxis.min).toBeLessThan(0); // 原点居中（交点 / 坐标轴上下文）
    expect(pairEl.xAxis.max).toBeGreaterThan(0);

    const point: EquationDraftPayload = { equation: 'x²+y²=0', outcome: { kind: 'point', params: { x: 0, y: 0 } } };
    const pointEl = createMathPlotElement(point, { centerX: 0, centerY: 0 });
    expect(pointEl.kind).toBe('point');
    expect(pointEl.error).toBeNull();
    expect(pointEl.equalRatio).toBe(true);

    // 空集：错误占位元素承载教学文案（研究报告 §3.2）
    const empty: EquationDraftPayload = {
      equation: 'x²+y²=-1',
      outcome: { kind: 'error', message: '该方程为空集：左侧恒正（或恒负）、无法等于 0，实数平面内无图像（如 x²+y²=−1）' },
    };
    const emptyPatch = mathPlotFieldsFromPayload(empty);
    expect(emptyPatch.kind).toBe('error');
    expect(emptyPatch.error).toContain('空集');
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

  it('line 元素（D7）：渲染管线 / 缓存 / 视窗全链路', () => {
    const el = makeElement({
      id: 'mp-line-1',
      equation: '3x+2y=6',
      kind: 'line',
      xAxis: { min: -9.7, max: 9.7 },
    });
    const { ctx, calls } = createMockCtx();
    expect(() => renderElement(ctx, el, VP)).not.toThrow();
    expect(calls.find((c) => c.op === 'translate')).toBeDefined();

    const render = resolvePlotRender(
      { equation: el.equation, kind: el.kind, xAxis: el.xAxis, equalRatio: el.equalRatio, sampleCount: el.sampleCount },
      { width: el.width, height: el.height },
      plotTokenFor(el.id),
    );
    expect(render.error).toBeUndefined();
    expect(render.polylines).toHaveLength(1);
    expect(render.polylines[0]).toHaveLength(2);
    for (const p of render.polylines[0]) {
      expect(Math.abs(3 * p.x + 2 * p.y - 6)).toBeLessThan(1e-6);
    }
    // 平移缩放不重采样：同 sig 二次调用零写入
    const before = plotRenderWriteCount();
    resolvePlotRender(
      { equation: el.equation, kind: el.kind, xAxis: el.xAxis, equalRatio: el.equalRatio, sampleCount: el.sampleCount },
      { width: el.width, height: el.height },
      plotTokenFor(el.id),
    );
    expect(plotRenderWriteCount()).toBe(before);
  });

  it('linePair / point 元素（ZOO-148）：渲染管线 / 折线 / 缓存全链路', () => {
    const pairEl = makeElement({
      id: 'mp-linepair-1',
      equation: 'x²-y²=0',
      kind: 'linePair',
      xAxis: { min: -9.2, max: 9.2 },
    });
    const { ctx } = createMockCtx();
    expect(() => renderElement(ctx, pairEl, VP)).not.toThrow();
    const pairRender = resolvePlotRender(
      { equation: pairEl.equation, kind: pairEl.kind, xAxis: pairEl.xAxis, equalRatio: pairEl.equalRatio, sampleCount: pairEl.sampleCount },
      { width: pairEl.width, height: pairEl.height },
      plotTokenFor(pairEl.id),
    );
    expect(pairRender.error).toBeUndefined();
    expect(pairRender.polylines).toHaveLength(2); // 两条直线
    for (const pl of pairRender.polylines) expect(pl).toHaveLength(2);
    // 每条折线落回 y=±x（lines[0]=x−y=0，lines[1]=x+y=0）
    for (const p of pairRender.polylines[0]) expect(Math.abs(p.x - p.y)).toBeLessThan(1e-9);
    for (const p of pairRender.polylines[1]) expect(Math.abs(p.x + p.y)).toBeLessThan(1e-9);
    // 平移缩放不重采样：同 sig 二次调用零写入
    const before = plotRenderWriteCount();
    resolvePlotRender(
      { equation: pairEl.equation, kind: pairEl.kind, xAxis: pairEl.xAxis, equalRatio: pairEl.equalRatio, sampleCount: pairEl.sampleCount },
      { width: pairEl.width, height: pairEl.height },
      plotTokenFor(pairEl.id),
    );
    expect(plotRenderWriteCount()).toBe(before);

    const pointEl = makeElement({
      id: 'mp-point-1',
      equation: '(x-1)²+(y+2)²=0',
      kind: 'point',
      xAxis: { min: -9.2, max: 9.2 },
    });
    expect(() => renderElement(ctx, pointEl, VP)).not.toThrow();
    const pointRender = resolvePlotRender(
      { equation: pointEl.equation, kind: pointEl.kind, xAxis: pointEl.xAxis, equalRatio: pointEl.equalRatio, sampleCount: pointEl.sampleCount },
      { width: pointEl.width, height: pointEl.height },
      plotTokenFor(pointEl.id),
    );
    expect(pointRender.error).toBeUndefined();
    expect(pointRender.polylines).toHaveLength(1); // 小圆标记
    const pl = pointRender.polylines[0].slice(0, -1); // 去掉闭合重复点，均匀角度均值即圆心
    const cx = pl.reduce((s2, p) => s2 + p.x, 0) / pl.length;
    const cy = pl.reduce((s2, p) => s2 + p.y, 0) / pl.length;
    expect(cx).toBeCloseTo(1, 6); // 标记圆心 = 退化点 (1, −2)
    expect(cy).toBeCloseTo(-2, 6);
  });

  it('parabola / hyperbola 元素（ZOO-147）：渲染管线 / 折线 / 缓存全链路', () => {
    const pEl = makeElement({ id: 'mp-parabola-1', equation: 'y²=4x', kind: 'parabola', xAxis: { min: -8, max: 8 } });
    const { ctx } = createMockCtx();
    expect(() => renderElement(ctx, pEl, VP)).not.toThrow();
    const pRender = resolvePlotRender(
      { equation: pEl.equation, kind: pEl.kind, xAxis: pEl.xAxis, equalRatio: pEl.equalRatio, sampleCount: pEl.sampleCount },
      { width: pEl.width, height: pEl.height },
      plotTokenFor(pEl.id),
    );
    expect(pRender.error).toBeUndefined();
    expect(pRender.polylines).toHaveLength(1);
    for (const p of pRender.polylines[0]) {
      expect(Math.abs(p.y * p.y - 4 * p.x)).toBeLessThan(1e-5 * Math.max(1, Math.abs(p.x)));
    }

    const hEl = makeElement({ id: 'mp-hyperbola-1', equation: '9x²-16y²=144', kind: 'hyperbola', xAxis: { min: -8, max: 8 } });
    expect(() => renderElement(ctx, hEl, VP)).not.toThrow();
    const hRender = resolvePlotRender(
      { equation: hEl.equation, kind: hEl.kind, xAxis: hEl.xAxis, equalRatio: hEl.equalRatio, sampleCount: hEl.sampleCount },
      { width: hEl.width, height: hEl.height },
      plotTokenFor(hEl.id),
    );
    expect(hRender.error).toBeUndefined();
    expect(hRender.polylines).toHaveLength(2); // 两支
    // 平移缩放不重采样承诺保持：同 sig 二次调用零写入
    const before = plotRenderWriteCount();
    resolvePlotRender(
      { equation: hEl.equation, kind: hEl.kind, xAxis: hEl.xAxis, equalRatio: hEl.equalRatio, sampleCount: hEl.sampleCount },
      { width: hEl.width, height: hEl.height },
      plotTokenFor(hEl.id),
    );
    expect(plotRenderWriteCount()).toBe(before);
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

  it('SVG：line 元素出曲线 path + 方程标签（D7 增量 case）', () => {
    const svg = exportToSvg([makeElement({ equation: '3x+2y=6', kind: 'line', xAxis: { min: -9.7, max: 9.7 } })]);
    expect(svg).toContain('<path d="M');
    expect(svg).toContain('3x+2y=6');
    expect(svg).not.toContain('undefined');
  });

  it('SVG：显隐开关受控（关网格 / 轴 / 标签）', () => {
    const svg = exportToSvg([makeElement({ showGrid: false, showAxis: false, showLabel: false })]);
    expect(svg).not.toMatch(/<line[^>]*#e5e7eb/); // 无网格线（卡片边框同色不受影响）
    expect(svg).not.toMatch(/<line[^>]*#9ca3af/); // 无轴线
    expect(svg).not.toContain('font-family="serif"'); // 无方程 chip 文本
  });
});
