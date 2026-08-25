/**
 * ƒ 面板模板分组折叠状态（ZOO-164）。
 *
 * 会话级模块单例：折叠选择在 EquationEditor 卸载（切工具 / 换选中元素）与
 * 手机紧凑布局面板收起再展开之间保持，直到页面刷新才回默认。
 * 默认第一组（基本函数，教学最高频）展开、其余收起。
 * 纯 TS 无 React 依赖（node 单测覆盖）；组件经 useSyncExternalStore 订阅。
 */
import { TEMPLATE_GROUPS } from './math/templates';

type Listener = () => void;

const listeners = new Set<Listener>();

let expandedIds: ReadonlySet<string> | null = null;

/** 快照（引用稳定，直到状态变更才换新 Set——useSyncExternalStore 要求） */
export function getExpandedGroupIds(): ReadonlySet<string> {
  if (expandedIds === null) {
    expandedIds = new Set(TEMPLATE_GROUPS.length > 0 ? [TEMPLATE_GROUPS[0].id] : []);
  }
  return expandedIds;
}

export function isGroupExpanded(groupId: string): boolean {
  return getExpandedGroupIds().has(groupId);
}

/** 切换某组展开 / 收起；未注册的组 id 忽略（数据变更防串） */
export function toggleGroupExpansion(groupId: string): void {
  const current = getExpandedGroupIds();
  const next = new Set(current);
  if (!TEMPLATE_GROUPS.some((g) => g.id === groupId)) return;
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  expandedIds = next;
  listeners.forEach((fn) => fn());
}

/** 订阅状态变更（useSyncExternalStore 订阅端）；返回取消函数 */
export function subscribeTemplateGroupCollapse(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 批量展开指定组（ZOO-204 后续：高级面板选中微积分分区时联动展开显式函数
 *  模板组）。只增不减——未列出的组保持原状态（互斥组不会被误展开 / 收起）；
 *  未注册 id 忽略；全部已展开时幂等不通知。 */
export function expandTemplateGroups(groupIds: readonly string[]): void {
  const next = new Set(getExpandedGroupIds());
  let changed = false;
  for (const id of groupIds) {
    if (TEMPLATE_GROUPS.some((g) => g.id === id) && !next.has(id)) {
      next.add(id);
      changed = true;
    }
  }
  if (!changed) return;
  expandedIds = next;
  listeners.forEach((fn) => fn());
}

/** 重置为默认并清空订阅（单测隔离用） */
export function resetTemplateGroupCollapse(): void {
  expandedIds = null;
  listeners.clear();
}
