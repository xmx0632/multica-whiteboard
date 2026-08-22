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
  convergeEquationCommit,
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

  it('创建侧叠加随载荷落元素（ZOO-190 修复 T2 遗留：fields.overlays 漏套）', () => {
    // f′ + 定积分叠加的创建流载荷（EquationEditor 草稿全量快照）
    const withOverlays: EquationDraftPayload = {
      equation: 'y=sin(x)',
      outcome: { kind: 'explicit' },
      overlays: [{ type: 'derivative' }, { type: 'integral', a: 0, b: Math.PI }],
    };
    const el = createMathPlotElement(withOverlays, { centerX: 0, centerY: 0 });
    expect(el.overlays).toEqual([{ type: 'derivative' }, { type: 'integral', a: 0, b: Math.PI }]);
    // 无叠加载荷：不落键（旧文档零迁移、无空壳字段）
    const plain = createMathPlotElement(explicit, { centerX: 0, centerY: 0 });
    expect(plain.overlays).toBeUndefined();
    // 空数组 = 显式清空 → 同样不落键
    const cleared = createMathPlotElement(
      { ...explicit, overlays: [] },
      { centerX: 0, centerY: 0 },
    );
    expect(cleared.overlays).toBeUndefined();
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

  it('控点命中：mathPlot 角 / 边可命中，画布空白处返回 null', () => {
    const el = makeElement();
    // 外框 (100,80)-(580,440)，选中框外扩 4px → se 角控点 ≈ (576,436)
    expect(hitTestSelectionHandle(el, { x: 578, y: 438 }, VP)).toBe('se');
    expect(hitTestSelectionHandle(el, { x: 100, y: 438 }, VP)).toBe('sw');
    // 东边中点控点 ≈ x=580, y=(76+444)/2=260
    expect(hitTestSelectionHandle(el, { x: 578, y: 260 }, VP)).toBe('e');
    expect(hitTestSelectionHandle(el, { x: 300, y: 260 }, VP)).toBeNull();
    expect(hitTestSelectionHandle(el, { x: 20, y: 20 }, VP)).toBeNull();
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

  it('旋转圆锥曲线元素（ZOO-149）：xy=1 / 5x²−6xy+5y²=8 渲染管线 / 折线 / 缓存全链路', () => {
    const rotH = makeElement({ id: 'mp-roth-1', equation: 'xy=1', kind: 'hyperbola', xAxis: { min: -8, max: 8 } });
    const { ctx } = createMockCtx();
    expect(() => renderElement(ctx, rotH, VP)).not.toThrow();
    const rhRender = resolvePlotRender(
      { equation: rotH.equation, kind: rotH.kind, xAxis: rotH.xAxis, equalRatio: rotH.equalRatio, sampleCount: rotH.sampleCount },
      { width: rotH.width, height: rotH.height },
      plotTokenFor(rotH.id),
    );
    expect(rhRender.error).toBeUndefined();
    expect(rhRender.polylines).toHaveLength(2); // 两支（含旋转）
    for (const pl of rhRender.polylines) {
      for (const p of pl) expect(Math.abs(p.x * p.y - 1)).toBeLessThan(1e-9 * (Math.abs(p.x * p.y) + 1));
    }

    const rotE = makeElement({ id: 'mp-rote-1', equation: '5x²-6xy+5y²=8', kind: 'ellipse', xAxis: { min: -3, max: 3 } });
    expect(() => renderElement(ctx, rotE, VP)).not.toThrow();
    const reRender = resolvePlotRender(
      { equation: rotE.equation, kind: rotE.kind, xAxis: rotE.xAxis, equalRatio: rotE.equalRatio, sampleCount: rotE.sampleCount },
      { width: rotE.width, height: rotE.height },
      plotTokenFor(rotE.id),
    );
    expect(reRender.error).toBeUndefined();
    expect(reRender.polylines).toHaveLength(1); // 闭合椭圆
    for (const p of reRender.polylines[0]) {
      expect(Math.abs(5 * p.x * p.x - 6 * p.x * p.y + 5 * p.y * p.y - 8)).toBeLessThan(1e-9 * 20);
    }
    // 平移缩放不重采样承诺保持：同 sig 二次调用零写入
    const before = plotRenderWriteCount();
    resolvePlotRender(
      { equation: rotE.equation, kind: rotE.kind, xAxis: rotE.xAxis, equalRatio: rotE.equalRatio, sampleCount: rotE.sampleCount },
      { width: rotE.width, height: rotE.height },
      plotTokenFor(rotE.id),
    );
    expect(plotRenderWriteCount()).toBe(before);

    // SVG 导出：旋转椭圆走 clipPath 曲线 path（几何 kind 越出卡片由裁剪兜底）
    const svg = exportToSvg([rotE]);
    expect(svg).toContain('<path');
    expect(svg).toContain('clip-path');
  });

  it('旋转形元素工厂（ZOO-149）：椭圆一般式载荷建元素、定义域取旋转包围盒', () => {
    const payload: EquationDraftPayload = {
      equation: '5x²-6xy+5y²=8',
      outcome: { kind: 'ellipse', params: { cx: 0, cy: 0, rx: 1, ry: 2, rotation: -Math.PI / 4 } },
    };
    const el = createMathPlotElement(payload, { centerX: 0, centerY: 0 });
    expect(el.kind).toBe('ellipse');
    expect(el.error).toBeNull();
    expect(el.equalRatio).toBe(true);
    expect(el.xAxis.min).toBeLessThan(-1.58); // 旋转 AABB：hypot(2·cos45°, 1·sin45°) ≈ 1.581
    expect(el.xAxis.max).toBeGreaterThan(1.58);
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

describe('方程编辑 → 元素更新 → 重采样（ZOO-155）', () => {
  const frame = { width: 480, height: 360 };

  it('方程变更换签名触发重采样：sin → cos 采样点随新方程更新', () => {
    const el = makeElement({ id: 'mp-zoo155-recos' });
    useStore.getState().addElement(el);
    const specOf = (e: MathPlotElement) => ({
      equation: e.equation, kind: e.kind, xAxis: e.xAxis,
      equalRatio: e.equalRatio, sampleCount: e.sampleCount,
    });
    const token = plotTokenFor(el.id);
    const r1 = resolvePlotRender(specOf(el), frame, token);
    expect(r1.error).toBeUndefined();
    const sinMid = r1.polylines[0][Math.floor(r1.polylines[0].length / 2)];
    expect(sinMid.y).toBeCloseTo(Math.sin(sinMid.x), 5);

    // store 直改方程（属性面板 onChange 路径）→ 同 id 渲染按新方程重采样
    useStore.getState().updateElementTransient(el.id, { equation: 'y=cos(x)' } as Partial<WhiteboardElement>);
    const updated = useStore.getState().elements.find((e) => e.id === el.id) as MathPlotElement;
    const r2 = resolvePlotRender(specOf(updated), frame, plotTokenFor(el.id));
    expect(r2.error).toBeUndefined();
    const cosMid = r2.polylines[0][Math.floor(r2.polylines[0].length / 2)];
    expect(cosMid.y).toBeCloseTo(Math.cos(cosMid.x), 5);
    expect(cosMid.y).not.toBeCloseTo(sinMid.y, 5); // 曲线确实变了
  });

  it('样式变更零重采样（§6.3 不回归）：方程不变仅改颜色仍命中缓存', () => {
    const el = makeElement({ id: 'mp-zoo155-style' });
    const token = plotTokenFor(el.id);
    const spec = {
      equation: el.equation, kind: el.kind, xAxis: el.xAxis,
      equalRatio: el.equalRatio, sampleCount: el.sampleCount,
    };
    resolvePlotRender(spec, frame, token);
    const before = plotRenderWriteCount();
    resolvePlotRender(spec, frame, token); // 方程与数学输入不变 → 命中
    expect(plotRenderWriteCount()).toBe(before);
  });

  it('convergeEquationCommit：合法显式方程产出数学字段补丁', () => {
    const r = convergeEquationCommit('  y=cos(x)  ');
    expect(r.error).toBeUndefined();
    expect(r.fields).toEqual({
      equation: 'y=cos(x)',
      kind: 'explicit',
      error: null,
    });
  });

  it('convergeEquationCommit：几何方程（圆）同步推导定义域与等比', () => {
    const r = convergeEquationCommit('x^2+y^2=9');
    expect(r.fields?.kind).toBe('circle');
    expect(r.fields?.equalRatio).toBe(true);
    expect(r.fields?.xAxis).toBeDefined();
    expect(r.fields?.xAxis!.max).toBeGreaterThanOrEqual(3);
  });

  it('convergeEquationCommit：非法方程 fields 为 null 并携带原因（不落错误占位）', () => {
    const r = convergeEquationCommit('y=');
    expect(r.fields).toBeNull();
    expect(r.error).toBeTruthy();
    const r2 = convergeEquationCommit('y=#');
    expect(r2.fields).toBeNull();
    expect(r2.error).toBeTruthy();
  });

  it('非法提交回滚语义：元素数学字段恢复快照后仍按原方程出图（保持原值）', () => {
    const el = makeElement({ id: 'mp-zoo155-revert' });
    useStore.getState().addElement(el);
    const before: MathPlotElement = { ...el, xAxis: { ...el.xAxis } };
    // 手势中直改为非法半截方程（属性面板 onChange 逐键路径）
    useStore.getState().updateElementTransient(el.id, { equation: 'y=' } as Partial<WhiteboardElement>);
    // 提交非法 → PropertyPanel 回滚数学字段到快照
    useStore.getState().updateElementTransient(el.id, {
      equation: before.equation, kind: before.kind, error: before.error,
      xAxis: { ...before.xAxis }, equalRatio: before.equalRatio,
    } as Partial<WhiteboardElement>);
    const restored = useStore.getState().elements.find((e) => e.id === el.id) as MathPlotElement;
    expect(restored.equation).toBe('y=sin(x)');
    expect(restored.kind).toBe('explicit');
    // 渲染按恢复后的方程出 sin 曲线（非错误占位）
    const r = resolvePlotRender(
      { equation: restored.equation, kind: restored.kind, xAxis: restored.xAxis, equalRatio: restored.equalRatio, sampleCount: restored.sampleCount },
      frame,
      plotTokenFor(el.id),
    );
    expect(r.error).toBeUndefined();
    const mid = r.polylines[0][Math.floor(r.polylines[0].length / 2)];
    expect(mid.y).toBeCloseTo(Math.sin(mid.x), 5);
  });

  it('合法提交收敛：显式 → 圆补丁换 kind / 定义域 / 等比（converge 产物可直接落元素）', () => {
    const el = makeElement({ id: 'mp-zoo155-tocircle' });
    useStore.getState().addElement(el);
    const fields = convergeEquationCommit('x^2+y^2=9').fields!;
    useStore.getState().updateElementTransient(el.id, fields as Partial<WhiteboardElement>);
    const updated = useStore.getState().elements.find((e) => e.id === el.id) as MathPlotElement;
    expect(updated.kind).toBe('circle');
    expect(updated.equalRatio).toBe(true);
    const r = resolvePlotRender(
      { equation: updated.equation, kind: updated.kind, xAxis: updated.xAxis, equalRatio: updated.equalRatio, sampleCount: updated.sampleCount },
      frame,
      plotTokenFor(el.id),
    );
    expect(r.error).toBeUndefined();
    // 圆：闭合折线，半径 3
    const pl = r.polylines[0];
    const far = Math.max(...pl.map((p) => Math.hypot(p.x, p.y)));
    expect(far).toBeCloseTo(3, 3);
  });
});
