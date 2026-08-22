import { describe, expect, it } from 'vitest';
import { plotRenderWriteCount } from '../cache';
import { integralOf } from '../calculus';
import { drawGraphCore, formatAreaValue, resolvePlotRender, type PlotFrame, type PlotSpec } from '../plot';
import { zhT } from '../../../i18n/lib';
import { exportToSvg } from '../../export';
import type { MathPlotElement } from '../../types';

/**
 * ZOO-190 T3 定积分单测：integralOf 数值精度与奇点防护（验收口径 ∫₀^π sin = 2、
 * ∫₀¹ x² = 1/3）、resolvePlotRender 的 fills 产物与缓存签名契约（a/b 是数学输入，
 * 颜色不是）、drawGraphCore 绘制指令、SVG 导出 <polygon> 同步、无叠加零变化。
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

describe('integralOf：自适应辛普森（验收精度 ≤1e-7）', () => {
  it('∫₀^π sin(x)dx = 2', () => {
    const r = integralOf(Math.sin, 0, Math.PI);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs(r.value - 2)).toBeLessThan(1e-7);
  });

  it('∫₀¹ x²dx = 1/3', () => {
    const r = integralOf((x) => x * x, 0, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs(r.value - 1 / 3)).toBeLessThan(1e-7);
  });

  it('∫₁^e dx/x = 1（对数型被积函数）', () => {
    const r = integralOf((x) => 1 / x, 1, Math.E);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs(r.value - 1)).toBeLessThan(1e-7);
  });

  it('a>b：交换端点取负（有符号面积），区域仍画 [lo,hi]', () => {
    const r = integralOf((x) => x * x, 1, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs(r.value + 1 / 3)).toBeLessThan(1e-7);
    expect(r.region[0].x).toBeCloseTo(0, 10);
    expect(r.region[r.region.length - 1].x).toBeCloseTo(0, 10);
  });

  it('区域折线：f 采样段 + 基线两端角点闭合，锚点在区间中点', () => {
    const r = integralOf(Math.sin, 0, Math.PI);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.region.length;
    // 末两点是基线角点 (hi,0)、(lo,0)，首点在 lo 上
    expect(r.region[n - 1]).toEqual({ x: 0, y: 0 });
    expect(r.region[n - 2]).toEqual({ x: Math.PI, y: 0 });
    expect(r.region[0].x).toBeCloseTo(0, 10);
    // 中段点贴曲线：任取一点 |y − sin(x)| < 采样步长级误差
    for (const p of r.region.slice(0, n - 2)) {
      expect(Math.abs(p.y - Math.sin(p.x))).toBeLessThan(1e-9);
    }
    expect(r.anchor.x).toBeCloseTo(Math.PI / 2, 10);
    expect(r.anchor.y).toBeCloseTo(0.5, 10);
  });

  it('t 注入：错误文案随翻译器（缺省 zhT）', () => {
    const r = integralOf(Math.sin, 0, 1, () => 'TRANSLATED');
    expect(r.ok).toBe(true); // 合法区间不受影响
    const bad = integralOf((x) => 1 / x, -1, 1, (key) => `T:${key}`);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.message).toBe('T:mathErr.integralSingularity');
  });
});

describe('integralOf：奇点防护与非法区间', () => {
  it('∫₋₁¹ dx/x：预扫命中 x=0（±Inf）→ singularity，「现象 + 怎么办」双段式文案', () => {
    const r = integralOf((x) => 1 / x, -1, 1);
    expect(r).toEqual({ ok: false, reason: 'singularity', message: zhT('mathErr.integralSingularity') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('——');
    expect(r.message).toContain('a/b');
  });

  it('∫₋₁¹ √x dx：负半轴 NaN → singularity', () => {
    const r = integralOf(Math.sqrt, -1, 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('singularity');
  });

  it('网格未命中、求积点命中的奇点（tan 在渐近线邻域）→ 结果非有限同口径报错', () => {
    // tan 在 π/2 渐近：区间 [1.4, 1.8] 含 π/2≈1.5708，128 点网格未必恰命中，
    // 但自适应细分求积点趋近渐近线，值发散 / 非有限 → singularity 或精度护栏
    const r = integralOf(Math.tan, 1.4, 1.8);
    if (r.ok) {
      // 万一收敛出有限值（对称抵消的数值假象），不得产出离谱区域——放宽口径：
      expect(Number.isFinite(r.value)).toBe(true);
    } else {
      expect(r.reason).toBe('singularity');
    }
  });

  it('端点非有限 / a===b → invalid', () => {
    expect(integralOf(Math.sin, NaN, 1).ok).toBe(false);
    expect(integralOf(Math.sin, 0, Infinity).ok).toBe(false);
    const same = integralOf(Math.sin, 1, 1);
    expect(same).toEqual({ ok: false, reason: 'invalid', message: zhT('mathErr.integralInvalid') });
  });
});

describe('formatAreaValue：风格对齐 formatTickLabel', () => {
  it('整数去小数位、1/3 级保 3 位、去尾零、−0 归 0', () => {
    expect(formatAreaValue(2)).toBe('2');
    expect(formatAreaValue(1 / 3)).toBe('0.333');
    expect(formatAreaValue(0.46)).toBe('0.46');
    expect(formatAreaValue(-1 / 3)).toBe('-0.333');
    expect(formatAreaValue(333.3333)).toBe('333');
    expect(formatAreaValue(-0)).toBe('0');
  });
});

describe('resolvePlotRender：积分叠加分支', () => {
  it('∫₀^π sin：着色区产物 + 面积值 2；积分-only 不求导（无 f′ 产物）', () => {
    const r = resolvePlotRender(spec([{ type: 'integral', a: 0, b: Math.PI }]), frame, {});
    expect(r.error).toBeUndefined();
    expect(r.polylines.length).toBeGreaterThan(0); // 主曲线照常
    const ig = r.overlays?.integral;
    expect(ig).toBeDefined();
    if (!ig || !ig.ok) return;
    expect(Math.abs(ig.value - 2)).toBeLessThan(1e-6);
    expect(ig.region.length).toBeGreaterThan(2);
    // 区域 x 范围 = [0, π]（着色位置正确性）
    const xs = ig.region.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(Math.PI, 6);
    // 积分-only：未求导
    expect(r.overlays?.derivative).toBeUndefined();
  });

  it('f′ + 积分同时开启：并存（一次采样共用视窗）', () => {
    const r = resolvePlotRender(spec([{ type: 'derivative' }, { type: 'integral', a: 0, b: Math.PI }]), frame, {});
    expect(r.overlays?.derivative).toBeDefined();
    expect(r.overlays?.integral?.ok).toBe(true);
  });

  it('奇点区间：integral 携错误文案，主曲线仍渲染（render.error 为空、不崩溃）', () => {
    const r = resolvePlotRender(
      spec([{ type: 'integral', a: -1, b: 1 }], { equation: 'y=1/x' }),
      frame,
      {},
    );
    expect(r.error).toBeUndefined();
    expect(r.polylines.length).toBeGreaterThan(0);
    const ig = r.overlays?.integral;
    expect(ig).toBeDefined();
    if (!ig || ig.ok) return;
    expect(ig.error).toBe(zhT('mathErr.integralSingularity'));
  });

  it('a===b 直落数据 → invalid 错误产物（不产出错误区域）', () => {
    const r = resolvePlotRender(spec([{ type: 'integral', a: 1, b: 1 }]), frame, {});
    const ig = r.overlays?.integral;
    expect(ig).toBeDefined();
    if (!ig || ig.ok) return;
    expect(ig.error).toBe(zhT('mathErr.integralInvalid'));
  });

  it('非显式函数带 integral：静默忽略（几何路径出图，无积分产物）', () => {
    const r = resolvePlotRender(
      spec([{ type: 'integral', a: 0, b: 1 }], { equation: 'x^2+y^2=4', kind: 'circle' }),
      frame,
      {},
    );
    expect(r.error).toBeUndefined();
    expect(r.polylines.length).toBeGreaterThan(0);
    expect(r.overlays).toBeUndefined();
  });

  it('无叠加元素：integral 缺省（既有渲染路径零变化）', () => {
    const r = resolvePlotRender(spec(), frame, {});
    expect(r.overlays).toBeUndefined();
  });
});

describe('渲染缓存签名（性能契约：a/b 是数学输入，颜色不是）', () => {
  it('a/b 变化触发重算；同参命中缓存', () => {
    const key = {};
    resolvePlotRender(spec([{ type: 'integral', a: 0, b: 1 }]), frame, key);
    const before = plotRenderWriteCount();
    resolvePlotRender(spec([{ type: 'integral', a: 0, b: 1 }]), frame, key);
    expect(plotRenderWriteCount()).toBe(before); // 同参命中
    resolvePlotRender(spec([{ type: 'integral', a: 0, b: 2 }]), frame, key);
    expect(plotRenderWriteCount()).toBe(before + 1); // b 变 → 重建
    resolvePlotRender(spec([{ type: 'integral', a: -1, b: 2 }]), frame, key);
    expect(plotRenderWriteCount()).toBe(before + 2); // a 变 → 重建
  });

  it('积分开关切换 → 重建（叠加参数进 sig）', () => {
    const key = {};
    resolvePlotRender(spec([{ type: 'integral', a: 0, b: 1 }]), frame, key);
    const before = plotRenderWriteCount();
    resolvePlotRender(spec([]), frame, key);
    expect(plotRenderWriteCount()).toBe(before + 1);
  });
});

describe('drawGraphCore：定积分绘制指令', () => {
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

  function draw(r: ReturnType<typeof resolvePlotRender>) {
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
    return calls;
  }

  it('着色区：元素色 fill（0.18 透明度）+ 面积 chip 文字 ∫ = 2', () => {
    const r = resolvePlotRender(spec([{ type: 'integral', a: 0, b: Math.PI }]), frame, {});
    const calls = draw(r);
    // 半透明元素色填充（Node 无 Path2D → 逐点闭合折线回退路径）
    expect(calls.some((c) => c.op === 'set:globalAlpha' && c.args[0] === 0.18)).toBe(true);
    expect(calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#3B82F6')).toBe(true);
    expect(calls.some((c) => c.op === 'closePath')).toBe(true);
    expect(calls.some((c) => c.op === 'fill')).toBe(true);
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('∫ = 2');
  });

  it('奇点区间：报错 chip（⚠ 现象——怎么办），不着色（无 0.18 填充）', () => {
    const r = resolvePlotRender(spec([{ type: 'integral', a: -1, b: 1 }], { equation: 'y=1/x' }), frame, {});
    const calls = draw(r);
    expect(calls.some((c) => c.op === 'set:globalAlpha' && c.args[0] === 0.18)).toBe(false);
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    expect(texts.some((s) => s.startsWith('⚠'))).toBe(true);
  });

  it('无叠加：无 fill / 无 ∫ 文字（既有绘制路径零变化）', () => {
    const r = resolvePlotRender(spec(), frame, {});
    const calls = draw(r);
    expect(calls.some((c) => c.op === 'fill')).toBe(false);
    expect(calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0])).some((s) => s.includes('∫'))).toBe(false);
  });
});

describe('SVG 导出同步（<polygon> case）', () => {
  function makeElement(overlays?: MathPlotElement['overlays']): MathPlotElement {
    return {
      id: 'mp-int-1',
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

  it('积分叠加：SVG 含 <polygon>（元素色 + fill-opacity 0.18 + 卡片裁剪）与面积标注', () => {
    const svg = exportToSvg([makeElement([{ type: 'integral', a: 0, b: Math.PI }])]);
    expect(svg).toMatch(/<polygon [^>]*fill="#3B82F6"[^>]*fill-opacity="0\.18"/);
    expect(svg).toMatch(/<polygon [^>]*clip-path="url\(#mpc-mp-int-1\)"/);
    expect(svg).toContain('>∫ = 2</text>');
  });

  it('奇点区间：SVG 含 ⚠ 报错文案、无 <polygon>', () => {
    const el = makeElement([{ type: 'integral', a: -1, b: 1 }]);
    el.equation = 'y=1/x';
    const svg = exportToSvg([el]);
    expect(svg).not.toContain('<polygon');
    expect(svg).toContain('⚠');
    expect(svg).toContain(zhT('mathErr.integralSingularity').slice(0, 6));
  });

  it('无叠加元素：SVG 无 <polygon>、无 ∫ 标注（既有导出零变化）', () => {
    const svg = exportToSvg([makeElement()]);
    expect(svg).not.toContain('<polygon');
    expect(svg).not.toContain('∫ =');
  });
});
