/**
 * 高级公式入口判定单测（ZOO-194 T0）。
 *
 * 零回归硬约束的逻辑层佐证：现有 9 种 kind 且不带 overlays / constants 的
 * 「普通元素」一律 visible=false —— MathPlotParams 不渲染任何新控件，
 * 编辑流程与现状一致。三类高级信号（overlays / constants / 新 kind）
 * 各自点亮入口，徽标数取 overlays 长度。
 */
import { describe, expect, it } from 'vitest';
import { advancedFormulaState } from '../advancedFormula';

describe('advancedFormulaState 普通元素（零回归基线）', () => {
  it.each([
    'explicit',
    'line',
    'linePair',
    'point',
    'parabola',
    'hyperbola',
    'circle',
    'ellipse',
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

  it('多信号并存 → 徽标数仅计 overlays', () => {
    expect(advancedFormulaState({ kind: 'polar', constants: { a: 1 }, overlays: [{ type: 'derivative' }] })).toEqual({
      visible: true,
      overlayCount: 1,
    });
  });
});
