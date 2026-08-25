/**
 * 高级公式入口判定单测（ZOO-194 T0）与「×10 邻域放大」预设换算单测（ZOO-193 T6）。
 *
 * 零回归硬约束的逻辑层佐证：现有 9 种 kind 且不带 overlays / constants 的
 * 「普通元素」一律 visible=false —— MathPlotParams 不渲染任何新控件，
 * 编辑流程与现状一致。三类高级信号（overlays / constants / 新 kind）
 * 各自点亮入口，徽标数取 overlays 长度。
 *
 * T6 换算覆盖：中心（缺省取域中心 / 域外钳制到边界）、宽度（10 倍收窄 /
 * 采样层宽度地板 0.1 幂等）、边界钳制（窗口平移回域内、不产生域外采样段）、
 * 浮点尾噪剥离；另含验收项——tan 在 π/2 邻域放大后（采样档 640）断笔正确、
 * 不出现伪竖线。
 */
import { describe, expect, it } from 'vitest';
import { advancedFormulaState, zoomNeighborhood } from '../advancedFormula';
import { parseEquation } from '../math/parse';
import { sampleExplicit } from '../math/sample';

describe('advancedFormulaState 普通元素（零回归基线）', () => {
  it.each([
    'explicit',
    'line',
    'linePair',
    'point',
    'circle',
    'error',
  ] as const)('kind=%s 无 overlays/constants → 不出现入口', (kind) => {
    expect(advancedFormulaState({ kind })).toEqual({ visible: false, overlayCount: 0 });
  });

  it('空对象 / kind 缺省 → 不出现入口（保守缺省）', () => {
    expect(advancedFormulaState({})).toEqual({ visible: false, overlayCount: 0 });
    expect(advancedFormulaState({ kind: undefined })).toEqual({ visible: false, overlayCount: 0 });
  });

  it('空 overlays 数组与空 constants 字典视为未启用（清空后回到普通元素表现）', () => {
    expect(advancedFormulaState({ kind: 'explicit', overlays: [] })).toEqual({ visible: false, overlayCount: 0 });
    expect(advancedFormulaState({ kind: 'explicit', constants: {} })).toEqual({ visible: false, overlayCount: 0 });
  });
});

describe('advancedFormulaState 高级信号点亮入口', () => {
  it('overlays 非空 → 入口出现，徽标数 = 叠加项数', () => {
    expect(advancedFormulaState({ kind: 'explicit', overlays: [{ type: 'derivative' }] })).toEqual({
      visible: true,
      overlayCount: 1,
    });
    expect(
      advancedFormulaState({ kind: 'explicit', overlays: [{ type: 'derivative' }, { type: 'tangent', x0: 1 }, { type: 'integral' }] }),
    ).toEqual({ visible: true, overlayCount: 3 });
  });

  it('constants 非空 → 入口出现，徽标数为 0（非叠加信号）', () => {
    expect(advancedFormulaState({ kind: 'explicit', constants: { A: 1, omega: 2 } })).toEqual({
      visible: true,
      overlayCount: 0,
    });
  });

  it('新 kind（T4 parametric / polar，及任何基础集外 kind）→ 入口出现', () => {
    expect(advancedFormulaState({ kind: 'parametric' })).toEqual({ visible: true, overlayCount: 0 });
    expect(advancedFormulaState({ kind: 'polar' })).toEqual({ visible: true, overlayCount: 0 });
  });

  it('圆锥曲线 kind（ZOO-215 ellipse / hyperbola / parabola）→ 标注入口出现，徽标数为 0', () => {
    expect(advancedFormulaState({ kind: 'ellipse' })).toEqual({ visible: true, overlayCount: 0 });
    expect(advancedFormulaState({ kind: 'hyperbola' })).toEqual({ visible: true, overlayCount: 0 });
    expect(advancedFormulaState({ kind: 'parabola' })).toEqual({ visible: true, overlayCount: 0 });
  });

  it('多信号并存 → 徽标数仅计 overlays', () => {
    expect(advancedFormulaState({ kind: 'polar', constants: { a: 1 }, overlays: [{ type: 'derivative' }] })).toEqual({
      visible: true,
      overlayCount: 1,
    });
  });
});

describe('zoomNeighborhood 中心换算（ZOO-193 T6）', () => {
  it('缺省中心 → 取当前域中心，宽度收窄 10 倍', () => {
    expect(zoomNeighborhood({ min: -10, max: 10 })).toEqual({ min: -1, max: 1 });
    expect(zoomNeighborhood({ min: 0, max: 2 })).toEqual({ min: 0.9, max: 1.1 });
  });

  it('自定义中心 → 窗口以中心对称', () => {
    expect(zoomNeighborhood({ min: -10, max: 10 }, 5)).toEqual({ min: 4, max: 6 });
  });

  it('中心近右界 → 窗口左移贴边（不越出域外）', () => {
    expect(zoomNeighborhood({ min: -10, max: 10 }, 9.8)).toEqual({ min: 8, max: 10 });
  });

  it('中心近左界 → 窗口右移贴边', () => {
    expect(zoomNeighborhood({ min: -10, max: 10 }, -10)).toEqual({ min: -10, max: -8 });
  });

  it('中心在域外 → 钳制到最近边界再开窗', () => {
    expect(zoomNeighborhood({ min: -10, max: 10 }, 50)).toEqual({ min: 8, max: 10 });
    expect(zoomNeighborhood({ min: -10, max: 10 }, -50)).toEqual({ min: -10, max: -8 });
  });

  it('中心 NaN（输入框非法）→ 按缺省域中心处理', () => {
    expect(zoomNeighborhood({ min: -10, max: 10 }, NaN)).toEqual({ min: -1, max: 1 });
  });
});

describe('zoomNeighborhood 宽度地板与边界钳制（ZOO-193 T6）', () => {
  it('目标宽度低于采样层下限 0.1 → 收窄到 0.1 为止', () => {
    expect(zoomNeighborhood({ min: -0.2, max: 0.2 })).toEqual({ min: -0.05, max: 0.05 });
  });

  it('连续点击逐级收窄，到地板后幂等（不压进采样非法区间）', () => {
    let d = { min: -6.28, max: 6.28 };
    d = zoomNeighborhood(d); // 12.56 → 1.256
    expect(d).toEqual({ min: -0.628, max: 0.628 });
    d = zoomNeighborhood(d); // 1.256 → 0.1256
    expect(d).toEqual({ min: -0.0628, max: 0.0628 });
    d = zoomNeighborhood(d); // 0.1256 → 0.1（地板）
    expect(d).toEqual({ min: -0.05, max: 0.05 });
    d = zoomNeighborhood(d); // 已在地板 → 原样返回
    expect(d).toEqual({ min: -0.05, max: 0.05 });
  });

  it('贴边地板窗口同样不越界（钳制与地板叠加）', () => {
    // 宽 0.15 → 地板 0.1，中心贴右界：窗口贴右边缘
    expect(zoomNeighborhood({ min: 0, max: 0.15 }, 0.14)).toEqual({ min: 0.05, max: 0.15 });
  });

  it('非法域（倒序 / 零宽 / 非有限）→ 原样返回，不做修复', () => {
    expect(zoomNeighborhood({ min: 5, max: 5 })).toEqual({ min: 5, max: 5 });
    expect(zoomNeighborhood({ min: 3, max: 1 })).toEqual({ min: 3, max: 1 });
    expect(zoomNeighborhood({ min: NaN, max: 1 })).toEqual({ min: NaN, max: 1 });
  });

  it('换算结果剥浮点尾噪（面板数值输入直显）', () => {
    expect(zoomNeighborhood({ min: -6.28, max: 6.28 }, 1.5708)).toEqual({ min: 0.9428, max: 2.1988 });
  });
});

describe('zoomNeighborhood × sampleExplicit 验收：tan 在 π/2 邻域放大（ZOO-193 T6）', () => {
  const fnOf = (eq: string) => {
    const r = parseEquation(eq);
    if (r.kind !== 'explicit') throw new Error(`期望 explicit: ${eq}`);
    return r.fn;
  };

  it('[-2π,2π] 以 π/2 为中心放大 → 域含 π/2、宽度合法可采样，640 档断成两段且无伪竖线', () => {
    const zoomed = zoomNeighborhood({ min: -6.28, max: 6.28 }, Math.PI / 2);
    // 放大窗口覆盖渐近线 π/2，且宽度 ≥ 采样层下限 0.1（不触 domainWidth 报错）
    expect(zoomed.min).toBeLessThanOrEqual(Math.PI / 2);
    expect(zoomed.max).toBeGreaterThanOrEqual(Math.PI / 2);
    expect(zoomed.max - zoomed.min).toBeGreaterThanOrEqual(0.1);

    const r = sampleExplicit(fnOf('y=tan(x)'), { xMin: zoomed.min, xMax: zoomed.max }, 640);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    // 渐近线 x=π/2 把曲线断成两段（左右各一段）
    expect(r.polylines.length).toBe(2);
    // 段内相邻点不得跨越整窗——渐近线处不出现伪竖线（断笔规则复用，无新增逻辑）
    for (const pl of r.polylines) {
      for (let i = 1; i < pl.length; i++) {
        const straddle =
          (pl[i - 1].y > r.yMax && pl[i].y < r.yMin) || (pl[i].y > r.yMax && pl[i - 1].y < r.yMin);
        expect(straddle, `段内贯穿：${pl[i - 1].y} → ${pl[i].y}`).toBe(false);
      }
      // 两段各在渐近线一侧
      expect(pl.every((p) => p.x < Math.PI / 2) || pl.every((p) => p.x > Math.PI / 2)).toBe(true);
    }
  });
});
