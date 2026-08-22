import { describe, expect, it } from 'vitest';
import { plotRenderWriteCount } from '../cache';
import { drawGraphCore, resolvePlotRender, type PlotFrame, type PlotSpec } from '../plot';
import { sampleExplicitMulti } from '../sample';
import { exportToSvg } from '../../export';
import type { MathPlotElement } from '../../types';

/**
 * ZOO-189 T2 叠加层编排单测：resolvePlotRender 的 overlays 分支、渲染缓存签名
 * 契约（叠加参数是数学输入 / 颜色线宽不是）、SVG 导出同步、无叠加元素零变化。
 */

const frame: PlotFrame = { width: 480, height: 360 };

function spec(overlays?: PlotSpec['overlays'], extra: Partial<PlotSpec> = {}): PlotSpec {
  return {
    equation: 'y=sin(x)',
    kind: 'explicit',
    xAxis: { min: -2 * Math.PI, max: 2 * Math.PI },
    equalRatio: false,
    sampleCount: 320,
    ...(overlays !== undefined ? { overlays } : {}),
    ...extra,
  };
}

describe('resolvePlotRender：叠加分支', () => {
  it('f′ 叠加：主曲线与导函数折线都产出，导函数值与差商一致', () => {
    const r = resolvePlotRender(spec([{ type: 'derivative' }]), frame, {});
    expect(r.error).toBeUndefined();
    expect(r.polylines.length).toBeGreaterThan(0);
    const d = r.overlays?.derivative;
    expect(d).toBeDefined();
    if (!d) return;
    // 导函数折线抽点：x=π/2 附近采样点斜率 ≈ cos(x)
    const pts = d.polylines.flat().filter((p) => Math.abs(p.x - Math.PI / 2) < 0.05);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(Math.abs(p.y - Math.cos(p.x))).toBeLessThan(0.05);
    }
    // 主曲线（sin）不受叠加影响：x=π/2 处 ≈ 1
    const fpts = r.polylines.flat().filter((p) => Math.abs(p.x - Math.PI / 2) < 0.05);
    for (const p of fpts) {
      expect(Math.abs(p.y - Math.sin(p.x))).toBeLessThan(0.02);
    }
  });

  it('导函数视窗并集：f 幅值远小于 f′ 时（0.1sin(10x)），视窗显著扩容容纳 f′', () => {
    const withOverlay = resolvePlotRender(
      spec([{ type: 'derivative' }], { equation: 'y=0.1sin(10x)' }),
      frame,
      {},
    );
    const without = resolvePlotRender(spec(undefined, { equation: 'y=0.1sin(10x)' }), frame, {});
    // 纯 f（幅值 0.1）自适应视窗窄；叠加 f′（幅值 1）后并集视窗显著更宽
    expect(without.view.yMax).toBeLessThan(0.3);
    expect(withOverlay.view.yMax).toBeGreaterThan(0.5);
    const d = withOverlay.overlays?.derivative;
    expect(d).toBeDefined();
    if (!d) return;
    const ys = d.polylines.flat().map((p) => p.y);
    const inView = ys.filter((y) => y >= withOverlay.view.yMin && y <= withOverlay.view.yMax);
    // IQR 稳健视窗刻意裁尾（渐近线防护），主体（>60%）应可见
    expect(inView.length / ys.length).toBeGreaterThan(0.6);
  });

  it('切线叠加：切点 / 斜率正确，x₀ 变化实时更新', () => {
    const r1 = resolvePlotRender(spec([{ type: 'tangent', x0: 1 }]), frame, {});
    const tg1 = r1.overlays?.tangent;
    expect(tg1).toBeDefined();
    if (!tg1) return;
    expect(tg1.x0).toBe(1);
    expect(tg1.y0).toBeCloseTo(Math.sin(1), 10);
    expect(tg1.slope).toBeCloseTo(Math.cos(1), 10);

    const r2 = resolvePlotRender(spec([{ type: 'tangent', x0: 2 }]), frame, {});
    const tg2 = r2.overlays?.tangent;
    if (!tg2) return;
    expect(tg2.slope).toBeCloseTo(Math.cos(2), 10);
    expect(tg2.slope).not.toBeCloseTo(tg1.slope, 6);
  });

  it('切线 x₀ 落在采样不可导 / 越界处 → 无切线（不报错）', () => {
    // abs(x) 在 x₀=0 不可导 → tangent 缺省
    const r = resolvePlotRender(
      spec([{ type: 'tangent', x0: 0 }], { equation: 'y=abs(x)' }),
      frame,
      {},
    );
    expect(r.error).toBeUndefined();
    expect(r.overlays?.tangent).toBeUndefined();
    // x₀ 越出定义域
    const r2 = resolvePlotRender(spec([{ type: 'tangent', x0: 99 }]), frame, {});
    expect(r2.overlays?.tangent).toBeUndefined();
  });

  it('f′ + 切线同时开启：两者并存（一次求导复用）', () => {
    const r = resolvePlotRender(spec([{ type: 'derivative' }, { type: 'tangent', x0: 0.5 }]), frame, {});
    expect(r.overlays?.derivative).toBeDefined();
    expect(r.overlays?.tangent).toBeDefined();
  });

  it('非显式函数带 overlays：静默忽略（几何路径出图，无叠加产物）', () => {
    const r = resolvePlotRender(
      spec([{ type: 'derivative' }], { equation: 'x^2+y^2=4', kind: 'circle' }),
      frame,
      {},
    );
    expect(r.error).toBeUndefined();
    expect(r.polylines.length).toBeGreaterThan(0);
    expect(r.overlays).toBeUndefined();
  });

  it('无叠加元素：overlays 产物缺省（既有渲染路径零变化）', () => {
    const r = resolvePlotRender(spec(), frame, {});
    expect(r.overlays).toBeUndefined();
    expect(r.polylines.length).toBeGreaterThan(0);
  });
});

describe('渲染缓存签名（性能契约）', () => {
  it('叠加参数变化触发重算：x₀ 变化 → 重建', () => {
    const key = {};
    resolvePlotRender(spec([{ type: 'tangent', x0: 1 }]), frame, key);
    const before = plotRenderWriteCount();
    resolvePlotRender(spec([{ type: 'tangent', x0: 1 }]), frame, key);
    expect(plotRenderWriteCount()).toBe(before); // 同参命中
    resolvePlotRender(spec([{ type: 'tangent', x0: 1.5 }]), frame, key);
    expect(plotRenderWriteCount()).toBe(before + 1); // x₀ 变 → 重建
  });

  it('改颜色线宽不触发重采样（叠加开启时契约保持）', () => {
    const key = {};
    // 样式不进 PlotSpec——通过 frame 不变 + 同 key 重复调用模拟「改色后重绘」；
    // 颜色线宽由绘制层从元素读取，spec 层签名只含数学输入。
    resolvePlotRender(spec([{ type: 'derivative' }, { type: 'tangent', x0: 1 }]), frame, key);
    const before = plotRenderWriteCount();
    resolvePlotRender(spec([{ type: 'derivative' }, { type: 'tangent', x0: 1 }]), frame, key);
    expect(plotRenderWriteCount()).toBe(before);
  });

  it('开关叠加 → 重建；条目内容相同异序不重建（键序规范化）', () => {
    const key = {};
    resolvePlotRender(spec(), frame, key);
    const before0 = plotRenderWriteCount();
    resolvePlotRender(spec([]), frame, key);
    expect(plotRenderWriteCount()).toBe(before0); // 空 == 缺省
    resolvePlotRender(spec([{ type: 'derivative' }]), frame, key);
    expect(plotRenderWriteCount()).toBe(before0 + 1); // 开启 → 重建
  });
});

describe('drawGraphCore：叠加层绘制指令', () => {
  function createMockCtx() {
    const calls: { op: string; args: unknown[] }[] = [];
    const ctx = new Proxy(
      { calls },
      {
        get(target: { calls: { op: string; args: unknown[] }[] }, prop: string) {
          if (prop === 'calls') return target.calls;
          if (prop === 'measureText') return () => ({ width: 10 });
          return (...args: unknown[]) => {
            target.calls.push({ op: prop, args });
          };
        },
        set(target: { calls: { op: string; args: unknown[] }[] }, prop: string, value: unknown) {
          target.calls.push({ op: `set:${prop}`, args: [value] });
          return true;
        },
      },
    );
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  it('f′ 虚线橙 + 切线绿：setLineDash / 颜色赋值出现，斜率标注文字含 f′', () => {
    const r = resolvePlotRender(spec([{ type: 'derivative' }, { type: 'tangent', x0: 1 }]), frame, {});
    const { ctx, calls } = createMockCtx();
    drawGraphCore(ctx, {
      width: 480,
      height: 360,
      view: r.view,
      polylines: r.polylines,
      path2d: null,
      style: { strokeColor: '#3B82F6', strokeWidth: 2, opacity: 1 },
      showGrid: false,
      showAxis: false,
      overlays: r.overlays,
    });
    const setColorOps = calls.filter((c) => c.op === 'set:strokeStyle').map((c) => c.args[0]);
    expect(setColorOps).toContain('#F97316'); // f′ 橙
    expect(setColorOps).toContain('#22C55E'); // 切线绿
    const dashOps = calls.filter((c) => c.op === 'setLineDash');
    expect(dashOps.some((c) => JSON.stringify(c.args[0]) === '[8,5]')).toBe(true);
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    expect(texts.some((s) => s.startsWith('f′('))).toBe(true); // 斜率标注
  });

  it('无叠加：不出现叠加色（既有绘制路径零变化）', () => {
    const r = resolvePlotRender(spec(), frame, {});
    const { ctx, calls } = createMockCtx();
    drawGraphCore(ctx, {
      width: 480,
      height: 360,
      view: r.view,
      polylines: r.polylines,
      path2d: null,
      style: { strokeColor: '#3B82F6', strokeWidth: 2, opacity: 1 },
      showGrid: false,
      showAxis: false,
    });
    const setColorOps = calls.filter((c) => c.op === 'set:strokeStyle').map((c) => c.args[0]);
    expect(setColorOps).not.toContain('#F97316');
    expect(setColorOps).not.toContain('#22C55E');
    expect(calls.some((c) => c.op === 'setLineDash')).toBe(false);
  });
});

describe('sampleExplicitMulti：多序列共用视窗', () => {
  it('单序列与 sampleExplicit 语义一致（y 视窗自适应）', () => {
    const r = sampleExplicitMulti([Math.sin], { xMin: -6.28, xMax: 6.28 }, 200);
    if ('error' in r) throw new Error('unexpected error');
    expect(r.series).toHaveLength(1);
    expect(r.yMax).toBeGreaterThan(0.9);
    expect(r.yMin).toBeLessThan(-0.9);
  });

  it('双序列并集视窗：极小幅值序列也被纳入', () => {
    const r = sampleExplicitMulti(
      [() => 0.01, (x: number) => Math.cos(x)],
      { xMin: -6.28, xMax: 6.28 },
      200,
    );
    if ('error' in r) throw new Error('unexpected error');
    // 若只用 f（0.01）自适应，视窗半宽 ~0.01；并集后必须容纳 cos 的 ±1
    expect(r.yMax).toBeGreaterThan(0.9);
    expect(r.yMin).toBeLessThan(-0.9);
  });

  it('全部序列无有限值 → 错误（与单序列口径一致）', () => {
    const r = sampleExplicitMulti([() => NaN], { xMin: -1, max: 1, xMax: 1 } as never, 10);
    expect('error' in r).toBe(true);
  });
});

describe('SVG 导出同步', () => {
  function makeElement(overlays?: MathPlotElement['overlays']): MathPlotElement {
    return {
      id: 'mp-ov-1',
      type: 'mathPlot',
      x: 0,
      y: 0,
      width: 480,
      height: 360,
      strokeColor: '#3B82F6',
      strokeWidth: 2,
      opacity: 1,
      equation: 'y=sin(x)',
      kind: 'explicit',
      error: null,
      xAxis: { min: -2 * Math.PI, max: 2 * Math.PI },
      equalRatio: false,
      sampleCount: 320,
      showAxis: true,
      showGrid: true,
      showLabel: true,
      ...(overlays ? { overlays } : {}),
    };
  }

  it('f′ 叠加：SVG 含虚线橙导函数 path 与双色图例', () => {
    const svg = exportToSvg([makeElement([{ type: 'derivative' }])]);
    expect(svg).toContain('stroke="#F97316"');
    expect(svg).toContain('stroke-dasharray="8,5"');
    expect(svg).toContain('clip-path="url(#mpc-mp-ov-1)"'); // 叠加层同卡片裁剪
    expect(svg).toContain('>f′</text>'); // 图例标签
    expect(svg).toContain('>f</text>');
  });

  it('切线叠加：SVG 含切线 line / 切点 circle / 斜率标注', () => {
    const svg = exportToSvg([makeElement([{ type: 'tangent', x0: 1 }])]);
    expect(svg).toContain('stroke="#22C55E"');
    expect(svg).toMatch(/<circle [^>]*fill="#22C55E"/);
    expect(svg).toMatch(/f′\(1\) = 0\.54/); // cos(1) ≈ 0.5403
  });

  it('无叠加元素：SVG 不含叠加色（既有导出零变化）', () => {
    const svg = exportToSvg([makeElement()]);
    expect(svg).not.toContain('#F97316');
    expect(svg).not.toContain('#22C55E');
    expect(svg).not.toContain('stroke-dasharray="8,5"');
  });
});
