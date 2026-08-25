import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ADVANCED_COLLAPSE_KEYS,
  advancedCollapseOpen,
  getAdvancedCollapseOverrides,
  setAdvancedCollapseOpen,
  subscribeAdvancedCollapse,
  resetAdvancedCollapse,
} from '../advancedPanelCollapse';

/** ZOO-204 方案 A：高级公式面板折叠覆盖 store（会话级模块单例，只存手动覆盖） */
describe('advancedPanelCollapse（分区折叠覆盖 store）', () => {
  beforeEach(() => {
    resetAdvancedCollapse();
  });

  it('无覆盖时一律返回自动缺省（组件按方程适用性传入）', () => {
    expect(advancedCollapseOpen('calculus', true)).toBe(true);
    expect(advancedCollapseOpen('calculus', false)).toBe(false);
    expect(advancedCollapseOpen('physics.marks', true)).toBe(true);
    expect(advancedCollapseOpen('parametric.domain', false)).toBe(false);
    expect(getAdvancedCollapseOverrides()).toEqual({});
  });

  it('手动覆盖优先于自动缺省，逐键独立', () => {
    // 方程是参数式：微积分区自动缺省收起，用户手动展开
    setAdvancedCollapseOpen('calculus', true);
    expect(advancedCollapseOpen('calculus', false)).toBe(true);
    // 其他键不受影响（仍走自动缺省）
    expect(advancedCollapseOpen('physics.marks', false)).toBe(false);
    expect(advancedCollapseOpen('parametric', true)).toBe(true);

    // 方程改回显式：自动缺省翻转，覆盖若在则继续生效（用户意图保持）
    setAdvancedCollapseOpen('physics.marks', false);
    expect(advancedCollapseOpen('physics.marks', true)).toBe(false);
  });

  it('快照引用稳定，仅在变更后替换（useSyncExternalStore 不死循环的前提）', () => {
    const before = getAdvancedCollapseOverrides();
    expect(getAdvancedCollapseOverrides()).toBe(before);
    setAdvancedCollapseOpen('constants', false);
    const after = getAdvancedCollapseOverrides();
    expect(after).not.toBe(before);
    expect(getAdvancedCollapseOverrides()).toBe(after);
    // 同值再写幂等：不换引用、不通知
    const listener = vi.fn();
    subscribeAdvancedCollapse(listener);
    setAdvancedCollapseOpen('constants', false);
    expect(getAdvancedCollapseOverrides()).toBe(after);
    expect(listener).not.toHaveBeenCalled();
  });

  it('未注册键忽略（键改名后旧覆盖不串入）', () => {
    const listener = vi.fn();
    subscribeAdvancedCollapse(listener);
    // @ts-expect-error 运行时防御：越界键（非 ADVANCED_COLLAPSE_KEYS 成员）
    setAdvancedCollapseOpen('stale.unknown.key', true);
    expect(getAdvancedCollapseOverrides()).toEqual({});
    expect(listener).not.toHaveBeenCalled();
  });

  it('订阅 / 退订：覆盖变更通知在册监听，退订后不再收', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribeA = subscribeAdvancedCollapse(a);
    subscribeAdvancedCollapse(b);
    setAdvancedCollapseOpen('parametric', false);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubscribeA();
    setAdvancedCollapseOpen('parametric', true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('reset 清覆盖并清订阅（单测隔离口径，模拟页面刷新回自动缺省）', () => {
    setAdvancedCollapseOpen('calculus', true);
    const listener = vi.fn();
    subscribeAdvancedCollapse(listener);
    resetAdvancedCollapse();
    expect(advancedCollapseOpen('calculus', false)).toBe(false);
    setAdvancedCollapseOpen('calculus', true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('键域覆盖四分区与两个内组（与面板实现的开合点一一对应）', () => {
    expect([...ADVANCED_COLLAPSE_KEYS]).toEqual(
      expect.arrayContaining(['calculus', 'physics', 'constants', 'parametric', 'physics.marks', 'parametric.domain']),
    );
  });
});
