/**
 * 全局键盘快捷键的编辑态守卫（ZOO-163）：
 *
 * 焦点在可编辑控件（input / textarea / contenteditable，含 ZOO-159 内联文字
 * 浮层的 textarea、右侧方程输入框）上时，按键属于文本输入——window 级快捷键
 * （空格平移 / 工具切换 / 撤销重做 / 删除选中）一律跳过：不 preventDefault、
 * 不触发动作。此前 Canvas 空格平移在 window 级无条件 preventDefault，把聚焦
 * textarea 里的空格字符吞掉（T 工具输入 `a b` 得到 `ab`）。
 *
 * Canvas.tsx / useShortcuts.ts 只做事件接线，守卫判定沉淀于此供单测
 * （本仓库惯例，同 gestures.ts）。
 */

/**
 * 事件目标（或任一焦点候选）是否为可编辑控件。
 * 非元素目标（window / document 等）无 tagName，视为非编辑态。
 */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
  return el.isContentEditable === true;
}
