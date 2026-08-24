/**
 * ZOO-206 基准方程位置回归：图形与坐标系（网格 / 轴 / 原点）必须同变换对齐。
 *
 * 背景：path2d 此前按完整外框尺寸构建变换，而 drawMathPlot 在内嵌绘图区
 * （四周让 PLOT_INNER_PAD）里 stroke——浏览器下所有方程相对坐标轴系统性
 * 偏移数 px（x²-y²=0 不过原点、y=√x 起笔偏移）。Node 单测无 Path2D 走折线
 * 回退（变换一致）故未暴露。本文件用 Path2D 桩模拟浏览器路径固化对齐不变量：
 * path2d 的每个像素点经「内嵌变换」反解回数学坐标，必须落在真实曲线上。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEquation } from '../parse';
import { PLOT_INNER_PAD, resolvePlotRender, type PlotSpec } from '../plot';
import { sampleExplicit } from '../sample';

const fnOf = (eq: string) => {
  const r = parseEquation(eq);
  if (r.kind !== 'explicit') throw new Error(`期望 explicit: ${eq}`);
  return r.fn;
};

/** 记录型 Path2D stub（浏览器路径模拟，与 plot.test.ts 同款）。 */
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
  closePath() {
    this.ops.push({ op: 'closePath', args: [] });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  MockPath2D.instances = [];
});

/** 基准方程集（issue 验收口径）与各自「是否在曲线上」的残差函数。 */
const CASES: Array<{ eq: string; kind: PlotSpec['kind']; equalRatio: boolean; onCurve: (x: number, y: number) => number }> = [
  { eq: 'y=x', kind: 'explicit', equalRatio: false, onCurve: (x, y) => Math.abs(y - x) },
  { eq: 'y=x^2', kind: 'explicit', equalRatio: false, onCurve: (x, y) => Math.abs(y - x * x) },
  { eq: 'y=sin(x)', kind: 'explicit', equalRatio: false, onCurve: (x, y) => Math.abs(y - Math.sin(x)) },
  { eq: 'y=sqrt(x)', kind: 'explicit', equalRatio: false, onCurve: (x, y) => Math.abs(y - Math.sqrt(x)) },
  { eq: 'x^2+y^2=4', kind: 'circle', equalRatio: true, onCurve: (x, y) => Math.abs(Math.hypot(x, y) - 2) },
  { eq: 'x^2-y^2=0', kind: 'linePair', equalRatio: false, onCurve: (x, y) => Math.abs(x * x - y * y) },
];

const FRAME = { width: 480, height: 360 };

describe('基准方程位置：path2d 与轴同变换（ZOO-206）', () => {
  it.each(CASES)('$eq 逆映射落在真实曲线上', ({ eq, kind, equalRatio, onCurve }) => {
    vi.stubGlobal('Path2D', MockPath2D);
    const spec: PlotSpec = { equation: eq, kind, xAxis: { min: -10, max: 10 }, equalRatio, sampleCount: 320 };
    const render = resolvePlotRender(spec, FRAME, {});
    expect(render.error, `解析失败: ${render.error}`).toBeUndefined();

    const innerW = FRAME.width - PLOT_INNER_PAD * 2;
    const innerH = FRAME.height - PLOT_INNER_PAD * 2;
    const { xMin, xMax, yMin, yMax } = render.view;
    const path = render.path2d as unknown as MockPath2D;
    expect(path?.ops.length ?? 0).toBeGreaterThanOrEqual(4); // 直线类 2 点/线

    let worst = 0;
    let n = 0;
    for (const op of path.ops) {
      if (op.args.length < 2) continue;
      const [px, py] = op.args;
      if (px < 0 || px > innerW || py < 0 || py > innerH) continue; // 越出裁剪边的采样点
      const mx = xMin + (px / innerW) * (xMax - xMin);
      const my = yMin + (1 - py / innerH) * (yMax - yMin);
      worst = Math.max(worst, onCurve(mx, my));
      n++;
    }
    if (kind !== 'linePair') {
      // 直线类端点刻意越出视窗（贯穿裁剪），窗口内无采样点，走下方线段判定
      expect(n).toBeGreaterThanOrEqual(2);
      expect(worst).toBeLessThan(1e-4);
    }

    // 直线类：每条线段（px 端点连线）必须精确穿过轴原点 px —— 应过原点的
    // 方程图形精确经过原点（x²-y²=0 两线交于轴原点）。
    if (kind === 'linePair') {
      const ox = (0 - xMin) * (innerW / (xMax - xMin));
      const oy = innerH - (0 - yMin) * (innerH / (yMax - yMin));
      const segs: Array<[number, number, number, number]> = [];
      for (let i = 0; i + 1 < path.ops.length; i += 2) {
        const a = path.ops[i]?.args;
        const b = path.ops[i + 1]?.args;
        if (a && b) segs.push([a[0], a[1], b[0], b[1]]);
      }
      expect(segs.length).toBe(2);
      for (const [ax, ay, bx, by] of segs) {
        const cross = Math.abs((bx - ax) * (oy - ay) - (by - ay) * (ox - ax));
        expect(cross / Math.hypot(bx - ax, by - ay)).toBeLessThan(0.01);
      }
    }
  });

  it('圆 x²+y²=4 视窗原点居中（圆心在原点）', () => {
    vi.stubGlobal('Path2D', MockPath2D);
    const render = resolvePlotRender(
      { equation: 'x^2+y^2=4', kind: 'circle', xAxis: { min: -10, max: 10 }, equalRatio: true, sampleCount: 320 },
      FRAME,
      {},
    );
    expect(render.error).toBeUndefined();
    expect(Math.abs(render.view.xMin + render.view.xMax)).toBeLessThan(1e-9);
    expect(Math.abs(render.view.yMin + render.view.yMax)).toBeLessThan(1e-9);
  });

  it('应过原点的显式方程视窗含 0（原点与横轴可见，y=√x 原点起笔）', () => {
    vi.stubGlobal('Path2D', MockPath2D);
    for (const eq of ['y=x', 'y=sin(x)', 'y=sqrt(x)']) {
      const render = resolvePlotRender(
        { equation: eq, kind: 'explicit', xAxis: { min: -10, max: 10 }, equalRatio: false, sampleCount: 320 },
        FRAME,
        {},
      );
      expect(render.error, eq).toBeUndefined();
      expect(render.view.yMin, `${eq} yMin`).toBeLessThan(0);
      expect(render.view.yMax, `${eq} yMax`).toBeGreaterThan(0);
    }
  });
});

describe('y 视窗自适应：贴近 0 纳入 0、远离 0 保持数据居中（ZOO-206）', () => {
  it('y=√x：视窗含 0 并留边距（横轴可见，曲线原点起笔）', () => {
    const r = sampleExplicit(fnOf('y=√x'), { xMin: -10, xMax: 10 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.yMin).toBeLessThan(-0.05); // 8% 边距，轴不贴底边
    expect(r.yMin).toBeGreaterThan(-0.5);
    expect(r.yMax).toBeGreaterThan(0);
  });

  it('y=x²+100：数据远离 0 不强行纳入（保持数据居中视窗）', () => {
    const r = sampleExplicit(fnOf('y=x^2+100'), { xMin: -10, xMax: 10 }, 320);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.yMin).toBeGreaterThan(0);
  });
});
