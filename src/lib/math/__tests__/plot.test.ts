import { afterEach, describe, expect, it, vi } from 'vitest';
import { plotRenderWriteCount } from '../cache';
import {
  axisUsesPi,
  buildPlotPath2D,
  createPlotTransform,
  drawGraphCore,
  drawMathPlot,
  formatTickLabel,
  niceStep,
  resolvePlotRender,
  stepForAxis,
  type PlotRender,
} from '../plot';
import { elementIntersectsView, renderElements } from '../../renderer';
import type { WhiteboardElement } from '../../types';

/** 记录型 ctx mock：方法调用与属性赋值都进 calls 列表。 */
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

/** 记录型 Path2D stub（Node 环境无 Path2D）。 */
class MockPath2D {
  static instances: MockPath2D[] = [];
  ops: { op: string; args: number[] }[] = [];
  constructor() {
    MockPath2D.instances.push(this);
  }
  moveTo(x: number, y: number) {
    this.ops.push({ op: 'moveTo', args: [x, y] });
  }
  lineTo(x: number, y: number) {
    this.ops.push({ op: 'lineTo', args: [x, y] });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  MockPath2D.instances = [];
});

describe('刻度系统（niceStep / π 轴 / 标签格式化）', () => {
  it('niceStep 取 1/2/2.5/5×10^k', () => {
    expect(niceStep(20, 8)).toBe(2.5);
    expect(niceStep(10, 6)).toBe(2);
    expect(niceStep(100, 8)).toBe(20);
    expect(niceStep(1, 8)).toBe(0.2); // 0.1×2（raw 0.125 ≤ 0.2 先命中）
  });

  it('π 轴判定：端点近 π/2 整数倍才启用', () => {
    expect(axisUsesPi(-2 * Math.PI, 2 * Math.PI)).toBe(true);
    expect(axisUsesPi(-6.28, 6.28)).toBe(true); // -2π~2π 预设的小数近似
    expect(axisUsesPi(-10, 10)).toBe(false);
    expect(axisUsesPi(-5, 5)).toBe(false);
    expect(axisUsesPi(1, 2)).toBe(false);
  });

  it('stepForAxis：普通域 45px 目标、π 域 π/2 步、MiniPreview 8px 密度同旧实现', () => {
    expect(stepForAxis(-10, 10, 360)).toEqual({ step: 2.5, pi: false });
    expect(stepForAxis(-2 * Math.PI, 2 * Math.PI, 360)).toEqual({ step: Math.PI / 2, pi: true });
    // MiniPreview（240 宽）保持 4a/4b 交付时的密度与步长
    expect(stepForAxis(-10, 10, 240, 8).step).toBe(1);
  });

  it('formatTickLabel：π 倍数与分数、普通数值去尾零', () => {
    expect(formatTickLabel(Math.PI, true, Math.PI / 2)).toBe('π');
    expect(formatTickLabel(2 * Math.PI, true, Math.PI)).toBe('2π');
    expect(formatTickLabel(Math.PI / 2, true, Math.PI / 2)).toBe('π/2');
    expect(formatTickLabel((3 * Math.PI) / 2, true, Math.PI / 2)).toBe('3π/2');
    expect(formatTickLabel(-Math.PI / 2, true, Math.PI / 2)).toBe('-π/2');
    expect(formatTickLabel(Math.PI / 3, true, Math.PI / 6)).toBe('π/3');
    expect(formatTickLabel(0, true, Math.PI / 2)).toBe('0');
    expect(formatTickLabel(4, false, 2)).toBe('4');
    expect(formatTickLabel(-4, false, 2)).toBe('-4');
    expect(formatTickLabel(1.5, false, 0.5)).toBe('1.5');
    expect(formatTickLabel(40, false, 20)).toBe('40');
    expect(formatTickLabel(-0, false, 0.5)).toBe('0');
  });
});

describe('createPlotTransform（§5.2 三层坐标映射）', () => {
  it('数学 y 向上映射为局部 y 向下，端点对齐', () => {
    const t = createPlotTransform({ xMin: -10, xMax: 10, yMin: -5, yMax: 5 }, 360, 270);
    expect(t.toPxX(-10)).toBeCloseTo(0);
    expect(t.toPxX(0)).toBeCloseTo(180);
    expect(t.toPxX(10)).toBeCloseTo(360);
    expect(t.toPxY(-5)).toBeCloseTo(270);
    expect(t.toPxY(0)).toBeCloseTo(135);
    expect(t.toPxY(5)).toBeCloseTo(0);
    expect(t.unitPxX).toBeCloseTo(18);
    expect(t.unitPxY).toBeCloseTo(27);
  });
});

describe('buildPlotPath2D（断笔 → moveTo，非有限点跳段）', () => {
  it('多段折线：单点段仅 moveTo，非有限 y 切段', () => {
    vi.stubGlobal('Path2D', MockPath2D);
    const t = createPlotTransform({ xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, 200, 200);
    const path = buildPlotPath2D(
      [
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        [{ x: 3, y: 0 }],
        [
          { x: 4, y: 4 },
          { x: 5, y: Number.NaN },
          { x: 6, y: 6 },
        ],
      ],
      t
    );
    const ops = (path as unknown as MockPath2D).ops;
    // 段1：moveTo+lineTo；段2：单点仅 moveTo；段3：NaN 断笔 → moveTo、moveTo（断后无连线）
    expect(ops.filter((o) => o.op === 'moveTo')).toHaveLength(4);
    expect(ops.filter((o) => o.op === 'lineTo')).toHaveLength(1);
  });
});

describe('resolvePlotRender（解析→采样→缓存编排）', () => {
  const frame = { width: 360, height: 270 };
  const sinSpec = {
    equation: 'y=sin(x)',
    kind: 'explicit' as const,
    xAxis: { min: -10, max: 10 },
    equalRatio: false,
    sampleCount: 320,
  };

  it('显式函数：产出折线与自适应 y 视窗', () => {
    vi.stubGlobal('Path2D', MockPath2D);
    const r = resolvePlotRender(sinSpec, frame, {});
    expect(r.error).toBeUndefined();
    expect(r.polylines.length).toBeGreaterThanOrEqual(1);
    expect(r.view.xMin).toBe(-10);
    expect(r.view.yMin).toBeLessThan(1); // sin 自适应视窗应覆盖 [-1,1] 附近
    expect(r.view.yMax).toBeGreaterThan(-1);
    expect(r.path2d).toBeInstanceOf(MockPath2D);
  });

  it('等比模式：y 视窗由定义域按宽高比推导（圆不变形）', () => {
    vi.stubGlobal('Path2D', MockPath2D);
    const r = resolvePlotRender({ ...sinSpec, equalRatio: true }, frame, {});
    // ySpan = 20 × 270/360 = 15
    expect(r.view.yMin).toBeCloseTo(-7.5, 6);
    expect(r.view.yMax).toBeCloseTo(7.5, 6);
  });

  it('缓存：同键同签名零重算，签名变化才重建（§6.3）', () => {
    vi.stubGlobal('Path2D', MockPath2D);
    const key = {};
    const before = plotRenderWriteCount();
    const r1 = resolvePlotRender(sinSpec, frame, key);
    expect(plotRenderWriteCount()).toBe(before + 1);
    const r2 = resolvePlotRender(sinSpec, frame, key);
    expect(plotRenderWriteCount()).toBe(before + 1); // 命中，无写入
    expect(r2).toBe(r1); // 同一条目引用
    resolvePlotRender({ ...sinSpec, sampleCount: 640 }, frame, key);
    expect(plotRenderWriteCount()).toBe(before + 2); // 采样档变化 → 重建
    // 样式/轴网显隐不在签名中（由 drawMathPlot 消费，不进 sig）
  });

  it('错误态：kind=error 或解析失败 → error 条目、折线为空', () => {
    vi.stubGlobal('Path2D', MockPath2D);
    const a = resolvePlotRender({ ...sinSpec, kind: 'error', errorMessage: '无法识别的符号 “#”' }, frame, {});
    expect(a.error).toBe('无法识别的符号 “#”');
    expect(a.polylines).toHaveLength(0);
    expect(a.path2d).toBeNull();
    const b = resolvePlotRender({ ...sinSpec, equation: 'y=#' }, frame, {});
    expect(b.error).toBeTruthy();
    expect(b.polylines).toHaveLength(0);
  });

  it('几何方程：按参数化包围盒给视窗', () => {
    vi.stubGlobal('Path2D', MockPath2D);
    const r = resolvePlotRender(
      { equation: '(x-1)²+(y-2)²=9', kind: 'circle', xAxis: { min: -3, max: 5 }, equalRatio: true, sampleCount: 320 },
      { width: 360, height: 360 },
      {}
    );
    expect(r.error).toBeUndefined();
    expect(r.polylines).toHaveLength(1);
    expect(r.polylines[0].length).toBe(121); // θ 参数化 120 段闭合
    expect(r.view.xMin).toBeLessThan(-2); // cx-r-留边
    expect(r.view.xMax).toBeGreaterThan(4);
  });

  it('几何方程等比单位（ZOO-147 修复）：4:3 卡片下 unitPxX === unitPxY，圆不为椭圆', () => {
    vi.stubGlobal('Path2D', MockPath2D);
    // 默认 480×360 元素卡：任何 aspect 的卡片，几何视窗纵横比必须与卡片一致
    for (const [w, h] of [[480, 360], [360, 270], [300, 400]] as const) {
      const r = resolvePlotRender(
        { equation: '(x-1)²+(y-2)²=9', kind: 'circle', xAxis: { min: -5, max: 7 }, equalRatio: true, sampleCount: 320 },
        { width: w, height: h },
        {}
      );
      const unitX = w / (r.view.xMax - r.view.xMin);
      const unitY = h / (r.view.yMax - r.view.yMin);
      expect(unitX / unitY, `${w}×${h}`).toBeCloseTo(1, 9);
    }
  });

  it('抛物线 / 双曲线：折线产出 + 等比单位（480×360 卡片）', () => {
    vi.stubGlobal('Path2D', MockPath2D);
    const parabola = resolvePlotRender(
      { equation: 'y²=4x', kind: 'parabola', xAxis: { min: -8, max: 8 }, equalRatio: true, sampleCount: 320 },
      { width: 480, height: 360 },
      {}
    );
    expect(parabola.error).toBeUndefined();
    expect(parabola.polylines).toHaveLength(1);
    const pu = 480 / (parabola.view.xMax - parabola.view.xMin);
    const pv = 360 / (parabola.view.yMax - parabola.view.yMin);
    expect(pu / pv).toBeCloseTo(1, 9);

    const hyperbola = resolvePlotRender(
      { equation: '9x²-16y²=144', kind: 'hyperbola', xAxis: { min: -8, max: 8 }, equalRatio: true, sampleCount: 320 },
      { width: 480, height: 360 },
      {}
    );
    expect(hyperbola.error).toBeUndefined();
    expect(hyperbola.polylines).toHaveLength(2);
    const hu = 480 / (hyperbola.view.xMax - hyperbola.view.xMin);
    const hv = 360 / (hyperbola.view.yMax - hyperbola.view.yMin);
    expect(hu / hv).toBeCloseTo(1, 9);
    // 渐近线教学正确性的渲染前提：顶点 ±4 与焦点 ±5 均在视窗内
    expect(hyperbola.view.xMax).toBeGreaterThanOrEqual(5);
    expect(hyperbola.view.xMin).toBeLessThanOrEqual(-5);
  });
});

describe('drawGraphCore（网格/轴/刻度/曲线分层）', () => {
  const view = { xMin: -10, xMax: 10, yMin: -5, yMax: 5 };
  const polylines = [
    [
      { x: -10, y: 0 },
      { x: 10, y: 0 },
    ],
  ];

  it('网格与轴按色值分层，曲线吃 style', () => {
    const { ctx, calls } = createMockCtx();
    drawGraphCore(ctx, {
      width: 360,
      height: 270,
      view,
      polylines,
      style: { strokeColor: '#123456', strokeWidth: 3, opacity: 0.9 },
      showGrid: true,
      showAxis: true,
      tickLabels: true,
    });
    const strokeStyles = calls.filter((c) => c.op === 'set:strokeStyle').map((c) => c.args[0]);
    expect(strokeStyles).toContain('#e5e7eb'); // 网格
    expect(strokeStyles).toContain('#9ca3af'); // 轴
    expect(strokeStyles).toContain('#123456'); // 曲线
    expect(calls.find((c) => c.op === 'set:globalAlpha')?.args[0]).toBe(0.9);
    // 原点十字轴：x=0 → 180.5px 竖线
    expect(calls.some((c) => c.op === 'moveTo' && c.args[0] === 180.5)).toBe(true);
    // 刻度数字：x 步 2.5 → 含 -7.5/5 等标签；y 轴侧标 0
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(texts).toContain('-7.5');
    expect(texts).toContain('5');
    expect(texts).toContain('0');
  });

  it('showGrid/showAxis 关闭时对应层不绘制；无标签模式无 fillText', () => {
    const { ctx, calls } = createMockCtx();
    drawGraphCore(ctx, {
      width: 360,
      height: 270,
      view,
      polylines,
      style: { strokeColor: '#123456', strokeWidth: 3, opacity: 1 },
      showGrid: false,
      showAxis: false,
    });
    const strokeStyles = calls.filter((c) => c.op === 'set:strokeStyle').map((c) => c.args[0]);
    expect(strokeStyles).not.toContain('#e5e7eb');
    expect(strokeStyles).not.toContain('#9ca3af');
    expect(strokeStyles).toContain('#123456');
    expect(calls.filter((c) => c.op === 'fillText')).toHaveLength(0);
  });

  it('path2d 走 ctx.stroke(path)，折线回退走 moveTo/lineTo', () => {
    vi.stubGlobal('Path2D', MockPath2D);
    const withPath = createMockCtx();
    const p2d = new MockPath2D();
    drawGraphCore(withPath.ctx, {
      width: 360,
      height: 270,
      view,
      polylines,
      path2d: p2d as unknown as Path2D,
      style: { strokeColor: '#000', strokeWidth: 2, opacity: 1 },
      showGrid: false,
      showAxis: false,
    });
    expect(withPath.calls.some((c) => c.op === 'stroke' && c.args[0] === p2d)).toBe(true);
    expect(withPath.calls.filter((c) => c.op === 'moveTo')).toHaveLength(0);

    const fallback = createMockCtx();
    drawGraphCore(fallback.ctx, {
      width: 360,
      height: 270,
      view,
      polylines,
      path2d: null,
      style: { strokeColor: '#000', strokeWidth: 2, opacity: 1 },
      showGrid: false,
      showAxis: false,
    });
    expect(fallback.calls.filter((c) => c.op === 'moveTo')).toHaveLength(1);
    expect(fallback.calls.filter((c) => c.op === 'lineTo')).toHaveLength(1);
  });
});

describe('drawMathPlot（§6.1 卡片整绘）', () => {
  const render: PlotRender = {
    polylines: [
      [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
    ],
    view: { xMin: -10, xMax: 10, yMin: -5, yMax: 5 },
    path2d: null,
  };

  it('白底 + 核心图 + 方程 chip（Unicode 美化）', () => {
    const { ctx, calls } = createMockCtx();
    drawMathPlot(ctx, {
      x: 0,
      y: 0,
      width: 360,
      height: 270,
      render,
      style: { strokeColor: '#3B82F6', strokeWidth: 2, opacity: 1 },
      showAxis: true,
      showGrid: true,
      showLabel: true,
      equation: 'y=2pi*x',
    });
    const fillStyles = calls.filter((c) => c.op === 'set:fillStyle').map((c) => c.args[0]);
    expect(fillStyles).toContain('rgba(255,255,255,0.88)'); // 第 1 层白底
    expect(fillStyles).toContain('rgba(59,130,246,0.08)'); // chip 底
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(texts).toContain('y=2π·x'); // label.ts 美化
  });

  it('showLabel=false 不画 chip', () => {
    const { ctx, calls } = createMockCtx();
    drawMathPlot(ctx, {
      x: 0,
      y: 0,
      width: 360,
      height: 270,
      render,
      style: { strokeColor: '#3B82F6', strokeWidth: 2, opacity: 1 },
      showAxis: true,
      showGrid: true,
      showLabel: false,
      equation: 'y=x',
    });
    const fillStyles = calls.filter((c) => c.op === 'set:fillStyle').map((c) => c.args[0]);
    expect(fillStyles).not.toContain('rgba(59,130,246,0.08)');
  });

  it('错误态：红虚线占位 + ⚠ 原因 + 重编辑提示', () => {
    const { ctx, calls } = createMockCtx();
    drawMathPlot(ctx, {
      x: 0,
      y: 0,
      width: 360,
      height: 270,
      render: { polylines: [], view: render.view, error: '无法识别的符号 “#”', path2d: null },
      style: { strokeColor: '#3B82F6', strokeWidth: 2, opacity: 1 },
      showAxis: true,
      showGrid: true,
      showLabel: true,
      equation: 'y=#',
    });
    expect(calls.some((c) => c.op === 'setLineDash' && JSON.stringify(c.args[0]) === '[6,4]')).toBe(true);
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(texts.some((t) => String(t).includes('⚠'))).toBe(true);
    expect(texts.some((t) => String(t).includes('重新编辑'))).toBe(true);
  });
});

describe('视口 culling（§6.4 配套，收益全元素）', () => {
  const vp = { offsetX: 0, offsetY: 0, scale: 1 };
  const rect = (x: number): WhiteboardElement =>
    ({ id: `r${x}`, type: 'rectangle', x, y: 0, width: 100, height: 100, strokeColor: '#000', strokeWidth: 2, opacity: 1, fillColor: null }) as WhiteboardElement;

  it('视口外元素被剔除，视口内与无包围盒元素保留', () => {
    expect(elementIntersectsView(rect(0), vp, 800, 600)).toBe(true);
    expect(elementIntersectsView(rect(1000), vp, 800, 600)).toBe(false);
    expect(elementIntersectsView(rect(-200), vp, 800, 600)).toBe(false);
    expect(elementIntersectsView({ id: 'p', type: 'path', x: 0, y: 0, points: [], strokeColor: '#000', strokeWidth: 2, opacity: 1 } as WhiteboardElement, vp, 800, 600)).toBe(true);
  });

  it('renderElements 传入视口尺寸时跳过视口外元素绘制', () => {
    const { ctx, calls } = createMockCtx();
    renderElements(ctx, [rect(1000), rect(0)], vp, { width: 800, height: 600 });
    expect(calls.filter((c) => c.op === 'strokeRect')).toHaveLength(1);
    const { ctx: ctx2, calls: calls2 } = createMockCtx();
    renderElements(ctx2, [rect(1000), rect(0)], vp);
    expect(calls2.filter((c) => c.op === 'strokeRect')).toHaveLength(2); // 不传尺寸 = 原行为
  });
});
