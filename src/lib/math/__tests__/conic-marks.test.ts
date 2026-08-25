import { describe, expect, it } from 'vitest';
import { plotRenderWriteCount } from '../cache';
import { conicMarks } from '../conicMarks';
import { parseEquation } from '../parse';
import { drawGraphCore, resolvePlotRender, type PlotFrame, type PlotSpec } from '../plot';
import { exportToSvg } from '../../export';
import type { MathPlotElement } from '../../types';
import { zhT } from '../../../i18n/lib';

/**
 * ZOO-215 圆锥曲线标注编排单测：conicMarks 派生坐标（六种圆锥曲线预置模板 +
 * 平移形，逐个对照手算）、resolvePlotRender 的 conic 叠加分支与渲染缓存签名
 * 契约、与微积分 / 物理叠加的互斥口径、SVG 导出同步。
 */

const frame: PlotFrame = { width: 480, height: 360 };
const view = { xMin: -6, xMax: 6, yMin: -4, yMax: 4 };

function spec(equation: string, kind: PlotSpec['kind'], extra: Partial<PlotSpec> = {}): PlotSpec {
  return {
    equation,
    kind,
    xAxis: { min: -10, max: 10 },
    equalRatio: true,
    sampleCount: 320,
    ...extra,
  };
}

/** 真实解析链路（parseEquation → conic 探针参数）派生标注。 */
function marksOf(equation: string) {
  const parsed = parseEquation(equation, zhT);
  return conicMarks(parsed as Parameters<typeof conicMarks>[0], view);
}

describe('conicMarks：派生坐标与手算一致', () => {
  it('椭圆 x²/9+y²/4=1：焦点 (±√5, 0)，标签 F₁F₂（焦点在长轴 = x 轴）', () => {
    const m = marksOf('x²/9+y²/4=1');
    expect(m.kind).toBe('ellipse');
    expect(m.foci.map((f) => f.label)).toEqual(['F₁', 'F₂']);
    expect(m.foci[0].x).toBeCloseTo(-Math.sqrt(5), 10);
    expect(m.foci[0].y).toBeCloseTo(0, 10);
    expect(m.foci[1].x).toBeCloseTo(Math.sqrt(5), 10);
    expect(m.foci[1].y).toBeCloseTo(0, 10);
    expect(m.asymptotes).toBeUndefined();
    expect(m.directrix).toBeUndefined();
  });

  it('平移椭圆 ry>rx：焦点沿 y 轴平移 —— (x-1)²/4+(y+2)²/16=1 焦点 (1, -2±2√3)', () => {
    const m = marksOf('(x-1)²/4+(y+2)²/16=1');
    expect(m.kind).toBe('ellipse');
    expect(m.foci[0].x).toBeCloseTo(1, 10);
    expect(m.foci[0].y).toBeCloseTo(-2 - 2 * Math.sqrt(3), 10);
    expect(m.foci[1].y).toBeCloseTo(-2 + 2 * Math.sqrt(3), 10);
  });

  it('双曲线 x²/9-y²/4=1：焦点 (±√13, 0)，渐近线 y=±(2/3)x（过中心贯穿）', () => {
    const m = marksOf('x²/9-y²/4=1');
    expect(m.kind).toBe('hyperbola');
    expect(m.foci[0].x).toBeCloseTo(-Math.sqrt(13), 10);
    expect(m.foci[1].x).toBeCloseTo(Math.sqrt(13), 10);
    expect(m.asymptotes).toHaveLength(2);
    for (const g of m.asymptotes ?? []) {
      // 两端点均在过原点、斜率 ±2/3 的直线上，且贯穿整个视窗（端点越出视界）
      const slope = (g.b.y - g.a.y) / (g.b.x - g.a.x);
      expect(Math.abs(Math.abs(slope) - 2 / 3)).toBeLessThan(1e-9);
      for (const p of [g.a, g.b]) {
        expect(Math.abs(p.y - slope * p.x)).toBeLessThan(1e-9); // 过原点
        expect(Math.hypot(p.x, p.y)).toBeGreaterThan(10); // 视窗外延（消费方裁剪）
      }
    }
    // 两条渐近线斜率互为相反数
    const slopes = (m.asymptotes ?? []).map((g) => (g.b.y - g.a.y) / (g.b.x - g.a.x));
    expect(slopes[0] + slopes[1]).toBeCloseTo(0, 10);
  });

  it('双曲线 y²/9-x²/4=1（实轴 y）：焦点 (0, ±√13)，渐近线 x=±(2/3)y', () => {
    const m = marksOf('y²/9-x²/4=1');
    expect(m.kind).toBe('hyperbola');
    expect(m.foci[0].y).toBeCloseTo(-Math.sqrt(13), 10);
    expect(m.foci[1].y).toBeCloseTo(Math.sqrt(13), 10);
    expect(m.foci[0].x).toBeCloseTo(0, 10);
    for (const g of m.asymptotes ?? []) {
      // 方向 (±b, a)=(±2, 3)：|x/y| = 2/3
      const dx = g.b.x - g.a.x;
      const dy = g.b.y - g.a.y;
      expect(Math.abs(Math.abs(dx / dy) - 2 / 3)).toBeLessThan(1e-9);
    }
  });

  it('含 xy 交叉项的旋转双曲线 xy=1：焦点 (±√2, ±√2)，渐近线即两坐标轴', () => {
    const m = marksOf('xy=1');
    expect(m.kind).toBe('hyperbola');
    expect(m.foci[0].x).toBeCloseTo(-Math.SQRT2, 10);
    expect(m.foci[0].y).toBeCloseTo(-Math.SQRT2, 10);
    expect(m.foci[1].x).toBeCloseTo(Math.SQRT2, 10);
    expect(m.foci[1].y).toBeCloseTo(Math.SQRT2, 10);
    const lines = (m.asymptotes ?? []).map((g) => ({
      vertical: Math.abs(g.a.x) < 1e-9 && Math.abs(g.b.x) < 1e-9,
      horizontal: Math.abs(g.a.y) < 1e-9 && Math.abs(g.b.y) < 1e-9,
    }));
    expect(lines.filter((l) => l.vertical)).toHaveLength(1);
    expect(lines.filter((l) => l.horizontal)).toHaveLength(1);
  });

  it('旋转椭圆 5x²-6xy+5y²=8：rx=1、ry=2（长轴沿 45°），焦点 (±√6/2, ±√6/2)', () => {
    const m = marksOf('5x²-6xy+5y²=8');
    expect(m.kind).toBe('ellipse');
    const c = Math.sqrt(3) / Math.SQRT2; // √(a²-b²)=√3 沿 45° 方向投影 = √6/2
    expect(m.foci[0].x).toBeCloseTo(-c, 9);
    expect(m.foci[0].y).toBeCloseTo(-c, 9);
    expect(m.foci[1].x).toBeCloseTo(c, 9);
    expect(m.foci[1].y).toBeCloseTo(c, 9);
  });

  it('抛物线 y²=4x：焦点 F=(1,0)，准线 x=-1（竖直贯穿线）', () => {
    const m = marksOf('y²=4x');
    expect(m.kind).toBe('parabola');
    expect(m.foci).toHaveLength(1);
    expect(m.foci[0].label).toBe('F');
    expect(m.foci[0].x).toBeCloseTo(1, 10);
    expect(m.foci[0].y).toBeCloseTo(0, 10);
    const d = m.directrix;
    expect(d).toBeDefined();
    expect(d!.a.x).toBeCloseTo(-1, 10);
    expect(d!.b.x).toBeCloseTo(-1, 10);
    expect(Math.abs(d!.a.y)).toBeGreaterThan(10); // 贯穿外延
    expect(Math.sign(d!.a.y)).not.toBe(Math.sign(d!.b.y));
  });

  it('抛物线 x²=4y（开口向上）：焦点 (0,1)，准线 y=-1（水平贯穿线）', () => {
    const m = marksOf('x²=4y');
    expect(m.kind).toBe('parabola');
    expect(m.foci[0].x).toBeCloseTo(0, 10);
    expect(m.foci[0].y).toBeCloseTo(1, 10);
    expect(m.directrix!.a.y).toBeCloseTo(-1, 10);
    expect(m.directrix!.b.y).toBeCloseTo(-1, 10);
  });

  it('旋转抛物线（rotation=90°）：焦点 / 准线随对称轴旋转——V=(1,-1)、p=2 → F=(1,1)、准线 y=-3', () => {
    const m = conicMarks(
      { kind: 'parabola', params: { h: 1, k: -1, p: 2, axis: 'x', rotation: Math.PI / 2 } },
      view,
    );
    expect(m.foci[0].x).toBeCloseTo(1, 10);
    expect(m.foci[0].y).toBeCloseTo(1, 10); // V + p·e₁，e₁=(0,1)
    expect(m.directrix!.a.y).toBeCloseTo(-3, 10); // 过 V - p·e₁=(1,-3)，⊥ e₁ → 水平
    expect(m.directrix!.b.y).toBeCloseTo(-3, 10);
  });

  it('与教学参数同源：焦点坐标与 conic.ts 面板展示（ellipseTeachingInfo）一致', () => {
    // 同一解析产物两条消费路径——标注与面板文字不得各算各的
    const parsed = parseEquation('5x²-6xy+5y²=8', zhT);
    const m = conicMarks(parsed as Parameters<typeof conicMarks>[0], view);
    const teaching = parsed.kind === 'ellipse' ? parsed.params : null;
    expect(teaching).not.toBeNull();
    // 手算面板形：foci = (cx ± c·ex, cy ± c·ey)，c=√(4-1)=√3、e=(√2/2, √2/2)
    expect(m.foci[1].x).toBeCloseTo(teaching!.cx + Math.sqrt(3) * Math.SQRT1_2, 9);
    expect(m.foci[1].y).toBeCloseTo(teaching!.cy + Math.sqrt(3) * Math.SQRT1_2, 9);
  });
});

describe('resolvePlotRender：conic 叠加分支', () => {
  it('椭圆 + conic 叠加：标注产出（焦点 ±√5 与手算一致），主曲线照常', () => {
    const r = resolvePlotRender(spec('x²/9+y²/4=1', 'ellipse', { overlays: [{ type: 'conic' }] }), frame, {});
    expect(r.error).toBeUndefined();
    expect(r.polylines.length).toBeGreaterThan(0);
    const cm = r.overlays?.conic;
    expect(cm).toBeDefined();
    expect(cm!.foci[1].x).toBeCloseTo(Math.sqrt(5), 10);
  });

  it('方程改动实时联动：x²/9+y²/4=1 → x²/25+y²/16=1 焦点 ±√5 → ±3', () => {
    const r1 = resolvePlotRender(spec('x²/9+y²/4=1', 'ellipse', { overlays: [{ type: 'conic' }] }), frame, {});
    const r2 = resolvePlotRender(spec('x²/25+y²/16=1', 'ellipse', { overlays: [{ type: 'conic' }] }), frame, {});
    expect(r1.overlays!.conic!.foci[1].x).toBeCloseTo(Math.sqrt(5), 10);
    expect(r2.overlays!.conic!.foci[1].x).toBeCloseTo(3, 10);
  });

  it('互斥口径：conic 条目对非圆锥曲线 kind 静默忽略、数据保留（几何照常出图）', () => {
    const r = resolvePlotRender(spec('y=sin(x)', 'explicit', { overlays: [{ type: 'conic' }] }), frame, {});
    expect(r.error).toBeUndefined();
    expect(r.polylines.length).toBeGreaterThan(0);
    expect(r.overlays?.conic).toBeUndefined(); // 不产出、不报错
    // 圆（焦点重合于圆心，无标注教学价值）同口径忽略
    const c = resolvePlotRender(spec('(x-1)²+(y-2)²=9', 'circle', { overlays: [{ type: 'conic' }] }), frame, {});
    expect(c.error).toBeUndefined();
    expect(c.overlays?.conic).toBeUndefined();
  });

  it('与微积分叠加互不覆盖：椭圆上 derivative 被忽略、conic 产出（各自按 kind 过滤）', () => {
    const r = resolvePlotRender(
      spec('x²/9-y²/4=1', 'hyperbola', { overlays: [{ type: 'derivative' }, { type: 'conic' }] }),
      frame,
      {},
    );
    expect(r.overlays?.conic).toBeDefined();
    expect(r.overlays?.derivative).toBeUndefined(); // 微积分仅显式函数
    // 反向：显式函数上 conic 被忽略、derivative 产出
    const e = resolvePlotRender(
      spec('y=sin(x)', 'explicit', { overlays: [{ type: 'derivative' }, { type: 'conic' }] }),
      frame,
      {},
    );
    expect(e.overlays?.derivative).toBeDefined();
    expect(e.overlays?.conic).toBeUndefined();
  });

  it('无 conic 叠加的圆锥曲线：overlays 产物缺省（既有渲染路径零变化）', () => {
    const r = resolvePlotRender(spec('x²/9+y²/4=1', 'ellipse'), frame, {});
    expect(r.error).toBeUndefined();
    expect(r.overlays).toBeUndefined();
  });

  it('渲染缓存签名：开关 conic → 重建；同参重复调用命中缓存', () => {
    const key = {};
    resolvePlotRender(spec('x²/9+y²/4=1', 'ellipse'), frame, key);
    const before = plotRenderWriteCount();
    resolvePlotRender(spec('x²/9+y²/4=1', 'ellipse'), frame, key);
    expect(plotRenderWriteCount()).toBe(before); // 同参命中
    resolvePlotRender(spec('x²/9+y²/4=1', 'ellipse', { overlays: [{ type: 'conic' }] }), frame, key);
    expect(plotRenderWriteCount()).toBe(before + 1); // 开标注 → 重建（实时联动）
    resolvePlotRender(spec('x²/9+y²/4=1', 'ellipse', { overlays: [{ type: 'conic' }] }), frame, key);
    expect(plotRenderWriteCount()).toBe(before + 1); // 再调命中
  });
});

describe('drawGraphCore：conic 标注绘制指令', () => {
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

  it('双曲线标注：青色虚线（节律同物理导引）+ 焦点点标记 + F₁F₂ 文字', () => {
    const r = resolvePlotRender(spec('x²/9-y²/4=1', 'hyperbola', { overlays: [{ type: 'conic' }] }), frame, {});
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
    expect(setColorOps).toContain('#0D9488'); // 标注青
    const dashOps = calls.filter((c) => c.op === 'setLineDash');
    expect(dashOps.some((c) => JSON.stringify(c.args[0]) === '[4,4]')).toBe(true); // 渐近线虚线节律
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('F₁');
    expect(texts).toContain('F₂');
    expect(calls.some((c) => c.op === 'arc')).toBe(true); // 焦点点标记（半径 4 同规格）
    const arcRadii = calls.filter((c) => c.op === 'arc').map((c) => c.args[2]);
    expect(arcRadii).toContain(4);
  });

  it('无叠加椭圆：不出现标注青与虚线（既有绘制路径零变化）', () => {
    const r = resolvePlotRender(spec('x²/9+y²/4=1', 'ellipse'), frame, {});
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
    expect(calls.filter((c) => c.op === 'set:strokeStyle').map((c) => c.args[0])).not.toContain('#0D9488');
    expect(calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0])).join()).not.toContain('F₁');
  });
});

describe('SVG 导出同步', () => {
  function makeElement(equation: string, kind: MathPlotElement['kind']): MathPlotElement {
    return {
      id: 'mp-conic-1',
      type: 'mathPlot',
      x: 0,
      y: 0,
      width: 480,
      height: 360,
      strokeColor: '#3B82F6',
      strokeWidth: 2,
      opacity: 1,
      equation,
      kind,
      error: null,
      xAxis: { min: -10, max: 10 },
      equalRatio: true,
      sampleCount: 320,
      showAxis: true,
      showGrid: true,
      showLabel: true,
      overlays: [{ type: 'conic' }],
    };
  }

  it('双曲线标注：SVG 含青色虚线渐近线 / 焦点 circle / F₁F₂ 文字（板书导出一致性）', () => {
    const svg = exportToSvg([makeElement('x²/9-y²/4=1', 'hyperbola')]);
    expect(svg).toContain('stroke="#0D9488"');
    expect(svg).toContain('stroke-dasharray="4,4"');
    expect(svg).toContain('clip-path="url(#mpc-mp-conic-1)"'); // 标注随卡片裁剪
    expect(svg).toMatch(/<circle [^>]*fill="#0D9488"/);
    expect(svg).toContain('>F₁</text>');
    expect(svg).toContain('>F₂</text>');
  });

  it('抛物线标注：SVG 含准线虚线与焦点 F', () => {
    const svg = exportToSvg([makeElement('y²=4x', 'parabola')]);
    expect(svg).toContain('stroke-dasharray="4,4"');
    expect(svg).toContain('>F</text>');
  });

  it('无叠加圆锥曲线：SVG 不含标注色（既有导出零变化）', () => {
    const el = makeElement('x²/9+y²/4=1', 'ellipse');
    delete el.overlays;
    const svg = exportToSvg([el]);
    expect(svg).not.toContain('#0D9488');
    expect(svg).not.toContain('stroke-dasharray="4,4"');
  });
});
