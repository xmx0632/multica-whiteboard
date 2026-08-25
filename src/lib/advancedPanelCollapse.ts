/**
 * 高级公式面板分区折叠状态（ZOO-204 方案 A：不适用控件组自动折叠）。
 *
 * 会话级模块单例（templateGroupCollapse 同款惯例）：本模块只存「手动覆盖」，
 * 缺省开合由组件按方程适用性实时推导——真相源保持唯一（方程形态），覆盖
 * 只在页面会话内有效，刷新即回自动缺省。纯 UI 态：不入元素数据、不入撤销
 * 历史（与面板开合口径一致）。
 *
 * 键域：四个分区（calculus / physics / constants / parametric）+ 两个死控件
 * 内组（physics.marks = R·H 标注行、parametric.domain = t/θ 域行）。内组
 * 折叠不藏分区——模板行（模式切换入口）常显，收起的只是不可用控件。
 *
 * 纯 TS 无 React 依赖（node 单测覆盖，templateGroupCollapse 同款）；
 * 组件经 useSyncExternalStore 订阅。
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** 折叠键全集（setAdvancedCollapseOpen 对未注册键忽略——键改名后旧覆盖不串） */
export const ADVANCED_COLLAPSE_KEYS = [
  'calculus',
  'physics',
  'constants',
  'parametric',
  'physics.marks',
  'parametric.domain',
] as const;

export type AdvancedCollapseKey = (typeof ADVANCED_COLLAPSE_KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(ADVANCED_COLLAPSE_KEYS);

/** 手动覆盖（键 → 用户设定的展开态）；null = 全部走自动缺省 */
let overrides: Readonly<Record<string, boolean>> | null = null;

const EMPTY: Readonly<Record<string, boolean>> = {};

/** 快照（引用稳定直到变更——useSyncExternalStore 要求） */
export function getAdvancedCollapseOverrides(): Readonly<Record<string, boolean>> {
  return overrides ?? EMPTY;
}

/** 当前生效开合：手动覆盖优先，否则组件按适用性传入的自动缺省 */
export function advancedCollapseOpen(key: AdvancedCollapseKey, defaultOpen: boolean): boolean {
  const v = getAdvancedCollapseOverrides()[key];
  return v === undefined ? defaultOpen : v;
}

/** 写入一次覆盖（幂等：值未变不通知）；未注册键忽略 */
export function setAdvancedCollapseOpen(key: AdvancedCollapseKey, open: boolean): void {
  if (!KEY_SET.has(key) || getAdvancedCollapseOverrides()[key] === open) return;
  overrides = { ...getAdvancedCollapseOverrides(), [key]: open };
  listeners.forEach((fn) => fn());
}

/** 订阅状态变更（useSyncExternalStore 订阅端）；返回取消函数 */
export function subscribeAdvancedCollapse(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 重置为自动缺省并清空订阅（单测隔离用） */
export function resetAdvancedCollapse(): void {
  overrides = null;
  listeners.clear();
}
