import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TEMPLATE_GROUPS } from '../math/templates';
import {
  getExpandedGroupIds,
  isGroupExpanded,
  toggleGroupExpansion,
  subscribeTemplateGroupCollapse,
  resetTemplateGroupCollapse,
} from '../templateGroupCollapse';

/** ZOO-164：ƒ 面板模板分组折叠状态（会话级模块单例） */
describe('templateGroupCollapse（分组折叠状态 store）', () => {
  beforeEach(() => {
    resetTemplateGroupCollapse();
  });

  it('默认：第一组展开、其余收起', () => {
    const expanded = getExpandedGroupIds();
    expect(expanded.size).toBe(1);
    expect(isGroupExpanded(TEMPLATE_GROUPS[0].id)).toBe(true);
    for (const g of TEMPLATE_GROUPS.slice(1)) {
      expect(isGroupExpanded(g.id)).toBe(false);
    }
  });

  it('toggle 切换展开 / 收起，多组可同时展开', () => {
    const second = TEMPLATE_GROUPS[1].id;
    toggleGroupExpansion(second);
    expect(isGroupExpanded(second)).toBe(true);
    expect(isGroupExpanded(TEMPLATE_GROUPS[0].id)).toBe(true);

    toggleGroupExpansion(second);
    expect(isGroupExpanded(second)).toBe(false);

    // 首组也可收起（允许全收起，进一步压缩面板）
    toggleGroupExpansion(TEMPLATE_GROUPS[0].id);
    expect(getExpandedGroupIds().size).toBe(0);
  });

  it('状态跨「面板卸载重挂」保持（会话内不丢，模拟收起再展开 / 切工具返回）', () => {
    toggleGroupExpansion(TEMPLATE_GROUPS[2].id);
    // EquationEditor 卸载不会触碰模块 store；重新读取即「重挂」后的快照
    const remountSnapshot = getExpandedGroupIds();
    expect(remountSnapshot.has(TEMPLATE_GROUPS[2].id)).toBe(true);
    expect(remountSnapshot.has(TEMPLATE_GROUPS[0].id)).toBe(true);
  });

  it('快照引用稳定，仅在变更后替换（useSyncExternalStore 不死循环的前提）', () => {
    const before = getExpandedGroupIds();
    expect(getExpandedGroupIds()).toBe(before);
    toggleGroupExpansion(TEMPLATE_GROUPS[1].id);
    const after = getExpandedGroupIds();
    expect(after).not.toBe(before);
  });

  it('未注册的组 id 忽略且不通知订阅者', () => {
    const fn = vi.fn();
    const unsubscribe = subscribeTemplateGroupCollapse(fn);
    toggleGroupExpansion('no-such-group');
    expect(fn).not.toHaveBeenCalled();
    expect(isGroupExpanded('no-such-group')).toBe(false);
    unsubscribe();
  });

  it('变更通知订阅者，退订后不再通知', () => {
    const fn = vi.fn();
    const unsubscribe = subscribeTemplateGroupCollapse(fn);
    toggleGroupExpansion(TEMPLATE_GROUPS[1].id);
    expect(fn).toHaveBeenCalledTimes(1);
    unsubscribe();
    toggleGroupExpansion(TEMPLATE_GROUPS[1].id);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
