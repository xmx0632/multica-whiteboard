import { describe, expect, it } from 'vitest';
import { parseEquation } from '../parse';
import {
  DEFAULT_SAMPLE_COUNT,
  MAX_SAMPLE_COUNT,
  clampSampleCount,
  createPreviewPolylines,
  sampleEquation,
  sampleExplicit,
  sampleGeometry,
} from '../sample';

const fnOf = (eq: string) => {
  const r = parseEquation(eq);
  if (r.kind !== 'explicit') throw new Error(`期望 explicit: ${eq}`);
  return r.fn;
};

describe('clampSampleCount（档位与硬上限）', () => {
  it('clamp 到 [2, 2000]，非法值回落默认档', () => {
    expect(clampSampleCount(320)).toBe(320);
    expect(clampSampleCount(640)).toBe(640);
    expect(clampSampleCount(5000)).toBe(MAX_SAMPLE_COUNT);
    expect(clampSampleCount(1)).toBe(2);
    expect(clampSampleCount(NaN)).toBe(DEFAULT_SAMPLE_COUNT);
  });
});

describe('sampleExplicit 定义域校验', () => {
  it('xmin ≥ xmax → 错误', () => {
    const r = sampleExplicit(fnOf('y=x'), { xMin: 5, xMax: 5 }, 160);
    expect(r).toEqual({ error: '定义域无效：xmin 需小于 xmax' });
    expect(sampleExplicit(fnOf('y=x'), { xMin: 5, xMax: 4 }, 160)).toEqual({ error: '定义域无效：xmin 需小于 xmax' });
  });

  it('宽度超出 [0.1, 1000] → 错误', () => {
    expect(sampleExplicit(fnOf('y=x'), { xMin: 0, xMax: 0.05 }, 160)).toEqual({
      error: '定义域无效：宽度需在 0.1–1000 之间',
    });
    expect(sampleExplicit(fnOf('y=x'), { xMin: 0, xMax: 2000 }, 160)).toEqual({
      error: '定义域无效：宽度需在 0.1–1000 之间',
    });
  });

  it('定义域内全无效 → 原型错误文案（不崩溃）', () => {
    const r = sampleExplicit(fnOf('y=√(-x²-1)'), { xMin: -10, xMax: 10 }, 160);
    expect(r).toEqual({ error: '定义域内无有效值' });
  });
});

describe('sampleExplicit 断笔（原型 §6：tan / 1/x 不贯穿渐近线）', () => {
  it('tan 在 [-10,10] 按渐近线断成多段', () => {
    const r = sampleExplicit(fnOf('y=tan(x)'), { xMin: -10, xMax: 10 }, 640);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    // 渐近线 x=±π/2, ±3π/2 → 5 段（数值摆动留裕量，断为 ≥4 段即可）
    expect(r.polylines.length).toBeGreaterThanOrEqual(4);
    // 每段内部相邻点不得跨越整窗（渐近线竖线已被切断）
    for (const pl of r.polylines) {
      for (let i = 1; i < pl.length; i++) {
        const straddle =
          (pl[i - 1].y > r.yMax && pl[i].y < r.yMin) || (pl[i].y > r.yMax && pl[i - 1].y < r.yMin);
        expect(straddle, `段内贯穿：${pl[i - 1].y} → ${pl[i].y}`).toBe(false);
      }
    }
  });

  it('1/x 在 [-10,10] 断成两段，x=0 不出现在折线中', () => {
    const r = sampleExplicit(fnOf('y=1/x'), { xMin: -10, xMax: 10 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polylines.length).toBe(2);
    expect(r.polylines.every((pl) => pl.every((p) => p.x !== 0))).toBe(true);
  });

  it('√x / ln(x)：负半轴无效点断笔，有效段保留', () => {
    const r = sampleExplicit(fnOf('y=√x'), { xMin: -10, xMax: 10 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polylines.length).toBe(1);
    expect(r.polylines[0][0].x).toBeGreaterThanOrEqual(0);
    expect(r.polylines[0].every((p) => p.x >= 0 && p.y >= 0)).toBe(true);

    const ln = sampleExplicit(fnOf('y=ln(x)'), { xMin: -10, xMax: 10 }, 320);
    expect('error' in ln).toBe(false);
    if ('error' in ln) return;
    expect(ln.polylines[0].every((p) => p.x > 0)).toBe(true);
  });

  it('陡峭单调曲线（x³）不误杀（风险 R3）', () => {
    const r = sampleExplicit(fnOf('y=x^3'), { xMin: -10, xMax: 10, yMin: -1000, yMax: 1000 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polylines.length).toBe(1);
  });

  it('显式 y 视窗被采用；非法（yMin≥yMax）时回退自适应', () => {
    const a = sampleExplicit(fnOf('y=sin(x)'), { xMin: -10, xMax: 10, yMin: -100, yMax: 100 }, 160);
    expect('error' in a).toBe(false);
    if ('error' in a) return;
    expect(a.yMin).toBe(-100);
    expect(a.yMax).toBe(100);

    const b = sampleExplicit(fnOf('y=sin(x)'), { xMin: -10, xMax: 10, yMin: 5, yMax: -5 }, 160);
    expect('error' in b).toBe(false);
    if ('error' in b) return;
    expect(b.yMax).toBeGreaterThan(b.yMin);
  });

  it('y 视窗自适应抗极端值（e^x 的 22026 不撑爆视窗）', () => {
    const r = sampleExplicit(fnOf('y=eˣ'), { xMin: -10, xMax: 10 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.yMax).toBeLessThan(1000);
    expect(r.yMax).toBeGreaterThan(1);
  });

  it('采样点数：默认档 320，超限 clamp 到 2000', () => {
    const a = sampleExplicit(fnOf('y=sin(x)'), { xMin: -10, xMax: 10 }, 5000);
    expect('error' in a).toBe(false);
    if ('error' in a) return;
    expect(a.polylines.reduce((n, pl) => n + pl.length, 0)).toBe(MAX_SAMPLE_COUNT);
  });
});

describe('sampleGeometry（圆/椭圆参数化精确路径）', () => {
  it('圆：闭合折线，半径正确，视窗含包围盒', () => {
    const r = sampleGeometry('circle', { cx: 1, cy: 2, r: 3 });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    const pl = r.polylines[0];
    // 闭合（θ=0 与 θ=2π 浮点误差内重合）
    expect(pl[pl.length - 1].x).toBeCloseTo(pl[0].x, 9);
    expect(pl[pl.length - 1].y).toBeCloseTo(pl[0].y, 9);
    for (const p of pl) {
      expect(Math.hypot(p.x - 1, p.y - 2)).toBeCloseTo(3, 6);
    }
    expect(r.xMin).toBeLessThan(-2);
    expect(r.xMax).toBeGreaterThan(4);
    expect(r.yMin).toBeLessThan(-1);
    expect(r.yMax).toBeGreaterThan(5);
  });

  it('椭圆：长短轴正确', () => {
    const r = sampleGeometry('ellipse', { cx: 0, cy: 0, rx: 3, ry: 2 });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    const pl = r.polylines[0];
    const xs = pl.map((p) => p.x);
    const ys = pl.map((p) => p.y);
    expect(Math.max(...xs)).toBeCloseTo(3, 6);
    expect(Math.max(...ys)).toBeCloseTo(2, 6);
  });
});

describe('sampleGeometry line（二元一次参数化，ZOO-146 / D7）', () => {
  const onLine = (p: { x: number; y: number }, a: number, b: number, c: number) =>
    Math.abs(a * p.x + b * p.y - c) < 1e-9 * Math.max(1, Math.abs(c));

  it('一般式：两端点在直线上，视窗原点居中且纵横比与卡片一致（ZOO-147 等比修复）', () => {
    const r = sampleGeometry('line', { a: 3, b: 2, c: 6 });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polylines).toHaveLength(1);
    expect(r.polylines[0]).toHaveLength(2); // 直线精确：两端点即折线
    for (const p of r.polylines[0]) expect(onLine(p, 3, 2, 6)).toBe(true);
    // 采样线段总长 ≥ 视窗对角线（任意方向均覆盖整个卡片，绘制层按矩形裁剪）
    const [e1, e2] = r.polylines[0];
    expect(Math.hypot(e2.x - e1.x, e2.y - e1.y)).toBeGreaterThanOrEqual(Math.SQRT2 * (r.xMax! - r.xMin!) - 1e-9);
    // 原点居中：坐标轴上下文可见（教学）；y 跨度 = aspect·x 跨度（默认 0.75，等比不失真）
    expect(r.xMin).toBeCloseTo(-r.xMax!, 9);
    expect(r.yMin).toBeCloseTo(-r.yMax!, 9);
    expect((r.yMax! - r.yMin!) / (r.xMax! - r.xMin!)).toBeCloseTo(0.75, 9);
  });

  it('竖线 x=3：视窗半宽纳入截距，两端点跨越视窗', () => {
    const r = sampleGeometry('line', { a: 1, b: 0, c: 3 });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    for (const p of r.polylines[0]) expect(onLine(p, 1, 0, 3)).toBe(true);
    expect(r.xMax!).toBeGreaterThanOrEqual(3);
    expect(r.xMin!).toBeLessThanOrEqual(-3);
    expect(Math.abs(r.polylines[0][0].y)).toBeGreaterThan(r.yMax!); // 越出视窗（卡片裁剪）
  });

  it('水平线 / 过原点线 / 远离原点的竖线（截距纳入视窗）', () => {
    const h = sampleGeometry('line', { a: 0, b: 2, c: 4 });
    expect('error' in h).toBe(false);
    if (!('error' in h)) expect(h.yMax!).toBeGreaterThanOrEqual(2);

    const diag = sampleGeometry('line', { a: 1, b: -1, c: 0 });
    expect('error' in diag).toBe(false);

    const far = sampleGeometry('line', { a: 1, b: 0, c: 100 });
    expect('error' in far).toBe(false);
    if (!('error' in far)) {
      expect(far.xMax!).toBeGreaterThanOrEqual(100); // 截距可见
      expect(far.xMin!).toBeLessThanOrEqual(-100); // 原点居中（y 轴上下文）
    }
  });

  it('a=b=0 防御：返回错误不崩溃', () => {
    expect(sampleGeometry('line', { a: 0, b: 0, c: 1 })).toEqual({ error: '该方程不表示直线' });
  });

  it('aspect 参数：纵横比一致的视窗（等比渲染不失真，ZOO-147）', () => {
    for (const aspect of [0.75, 0.4, 1, 1.5]) {
      const r = sampleGeometry('line', { a: 3, b: 2, c: 6 }, aspect);
      if ('error' in r) throw new Error('unexpected error');
      expect((r.yMax! - r.yMin!) / (r.xMax! - r.xMin!), `aspect=${aspect}`).toBeCloseTo(aspect, 9);
      // 锚点（最近点/截距）均纳入视窗
      expect(Math.abs(6 / 2)).toBeLessThanOrEqual(r.yMax! + 1e-9); // y 截距 3 可见
      expect(Math.abs(6 / 3)).toBeLessThanOrEqual(r.xMax! + 1e-9); // x 截距 2 可见
    }
    // 圆：任意纵横比下形状完整且不裁剪（等比修复的核心回归）
    const c = sampleGeometry('circle', { cx: 0, cy: 0, r: 3 }, 0.75);
    if ('error' in c) throw new Error('unexpected error');
    expect(c.xMin!).toBeLessThanOrEqual(-3);
    expect(c.xMax!).toBeGreaterThanOrEqual(3);
    expect(c.yMin!).toBeLessThanOrEqual(-3);
    expect(c.yMax!).toBeGreaterThanOrEqual(3);
    expect((c.yMax! - c.yMin!) / (c.xMax! - c.xMin!)).toBeCloseTo(0.75, 9);
  });
});

describe('sampleGeometry parabola / hyperbola（二元二次参数化，ZOO-147 / D7）', () => {
  it('抛物线 y²=4x：点满足方程、顶点/焦点纳入视窗、纵横比一致', () => {
    const r = sampleGeometry('parabola', { h: 0, k: 0, p: 1, axis: 'x' });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polylines).toHaveLength(1); // 单支连续曲线
    const pl = r.polylines[0];
    expect(pl.length).toBeGreaterThanOrEqual(100);
    for (const p of pl) {
      expect(Math.abs(p.y * p.y - 4 * p.x)).toBeLessThan(1e-6 * Math.max(1, Math.abs(p.x)));
    }
    expect(pl[0].y).toBeLessThan(r.yMin!); // 两端越出卡片（裁剪贯穿）
    expect(pl[pl.length - 1].y).toBeGreaterThan(r.yMax!);
    expect(r.xMin!).toBeLessThanOrEqual(0); // 顶点可见
    expect(r.xMax!).toBeGreaterThanOrEqual(1); // 焦点 (1,0) 可见
    expect((r.yMax! - r.yMin!) / (r.xMax! - r.xMin!)).toBeCloseTo(0.75, 9);
  });

  it('抛物线四方向 + 平移：开口向左 / 向上 / (y−1)²=8(x+2)', () => {
    const left = sampleGeometry('parabola', { h: 0, k: 0, p: -1, axis: 'x' });
    if ('error' in left) return;
    for (const p of left.polylines[0]) expect(p.x).toBeLessThanOrEqual(1e-9);

    const up = sampleGeometry('parabola', { h: 0, k: 0, p: 0.5, axis: 'y' });
    if ('error' in up) return;
    for (const p of up.polylines[0]) expect(p.y).toBeGreaterThanOrEqual(-1e-9);

    const mv = sampleGeometry('parabola', { h: -2, k: 1, p: 2, axis: 'x' });
    if ('error' in mv) return;
    for (const p of mv.polylines[0]) {
      expect(Math.abs((p.y - 1) * (p.y - 1) - 8 * (p.x + 2))).toBeLessThan(1e-5 * Math.max(1, Math.abs(p.x + 2)));
    }
    expect(mv.xMin!).toBeLessThanOrEqual(-2); // 顶点可见
  });

  it('双曲线 9x²−16y²=144（a=4,b=3）：两支、点满足方程、顶点/焦点纳入视窗', () => {
    const r = sampleGeometry('hyperbola', { h: 0, k: 0, a: 4, b: 3, axis: 'x' });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polylines).toHaveLength(2); // 两支
    const all = [...r.polylines[0], ...r.polylines[1]];
    for (const p of all) {
      expect(Math.abs((p.x * p.x) / 16 - (p.y * p.y) / 9 - 1)).toBeLessThan(1e-6);
    }
    const xs = all.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(r.xMin! - 1); // 越出卡片（裁剪贯穿）
    expect(Math.max(...xs)).toBeGreaterThan(r.xMax! + 1);
    expect(r.xMax!).toBeGreaterThanOrEqual(5); // 焦点 (±5,0) 可见
    expect((r.yMax! - r.yMin!) / (r.xMax! - r.xMin!)).toBeCloseTo(0.75, 9);
    // 两支各在顶点 x=±4 处有采样点（顶点可见）
    expect(Math.min(...r.polylines[0].map((p) => p.x))).toBeCloseTo(4, 6);
    expect(Math.max(...r.polylines[1].map((p) => p.x))).toBeCloseTo(-4, 6);
  });

  it('双曲线实轴 y + 平移：y²/9−x²/4=1 平移至中心 (1,−2)', () => {
    const r = sampleGeometry('hyperbola', { h: 1, k: -2, a: 3, b: 2, axis: 'y' });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    for (const p of [...r.polylines[0], ...r.polylines[1]]) {
      const dy = (p.y + 2) / 3;
      const dx = (p.x - 1) / 2;
      expect(Math.abs(dy * dy - dx * dx - 1)).toBeLessThan(1e-6);
    }
  });

  it('p=0 / 非法半轴防御：返回错误不崩溃', () => {
    expect(sampleGeometry('parabola', { h: 0, k: 0, p: 0, axis: 'x' })).toEqual({ error: '该方程不表示抛物线' });
    expect(sampleGeometry('hyperbola', { h: 0, k: 0, a: 0, b: 3, axis: 'x' })).toEqual({ error: '该方程不表示双曲线' });
  });

  it('sampleEquation 分发：y²=4x / 9x²−16y²=144 → 几何折线', () => {
    const p = sampleEquation(parseEquation('y²=4x'), { xMin: -10, xMax: 10, aspect: 0.75 });
    expect('error' in p).toBe(false);
    if (!('error' in p)) expect(p.polylines).toHaveLength(1);
    const h = sampleEquation(parseEquation('9x²-16y²=144'), { xMin: -10, xMax: 10, aspect: 0.75 });
    expect('error' in h).toBe(false);
    if (!('error' in h)) expect(h.polylines).toHaveLength(2);
  });

  it('sampleEquation 分发：3x+2y=6 → line 折线', () => {
    const r = sampleEquation(parseEquation('3x+2y=6'), { xMin: -10, xMax: 10 });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polylines).toHaveLength(1);
    for (const p of r.polylines[0]) {
      expect(Math.abs(3 * p.x + 2 * p.y - 6)).toBeLessThan(1e-9 * Math.max(1, Math.abs(6)));
    }
  });
});

describe('sampleEquation 统一分发（4c 渲染管线入口）', () => {
  it('error 结果透传', () => {
    const r = sampleEquation(parseEquation('y=foo(x)'), { xMin: -10, xMax: 10 });
    expect(r).toEqual({ error: '无法识别的符号 “foo”' });
  });

  it('explicit / circle 分发正确', () => {
    const e = sampleEquation(parseEquation('y=sin(x)'), { xMin: 0, xMax: Math.PI * 2 });
    expect('error' in e).toBe(false);
    const c = sampleEquation(parseEquation('x²+y²=4'), { xMin: -10, xMax: 10 });
    expect('error' in c).toBe(false);
    if ('error' in c) return;
    expect(c.polylines.length).toBe(1);
  });
});

describe('createPreviewPolylines（编辑器预览注入点）', () => {
  it('显式函数：默认视窗 x∈[-10,10]，返回 y 自适应视窗', () => {
    const p = createPreviewPolylines('y=sin(x)', { kind: 'explicit' });
    expect(p).not.toBeNull();
    expect(p!.xMin).toBe(-10);
    expect(p!.xMax).toBe(10);
    expect(p!.yMax!).toBeGreaterThan(p!.yMin!);
    expect(p!.polylines.length).toBe(1);
    expect(p!.polylines[0].length).toBe(DEFAULT_SAMPLE_COUNT);
  });

  it('圆：视窗来自参数化包围盒', () => {
    const p = createPreviewPolylines('(x-1)²+(y-2)²=9', { kind: 'circle', params: { cx: 1, cy: 2, r: 3 } });
    expect(p).not.toBeNull();
    expect(p!.xMin).toBeLessThan(-2);
    expect(p!.xMax).toBeGreaterThan(4);
  });

  it('直线（二元一次）：预览走 line 参数化分支', () => {
    const p = createPreviewPolylines('3x+2y=6', { kind: 'line', params: { a: 3, b: 2, c: 6 } });
    expect(p).not.toBeNull();
    expect(p!.polylines).toHaveLength(1);
    expect(p!.xMax!).toBeGreaterThan(0);
  });

  it('error / 解析失败 → null（预览退回空坐标系）', () => {
    expect(createPreviewPolylines('y=2+', { kind: 'error', message: '表达式不完整' })).toBeNull();
    expect(createPreviewPolylines('y=foo(x)', { kind: 'explicit' })).toBeNull();
  });
});
