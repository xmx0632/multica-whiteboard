/**
 * 模态打开判定（ZOO-209 抽出为单一来源）：帮助面板 / 高级公式面板（role=dialog）
 * 与确认弹窗（role=alertdialog）打开期间，全局快捷键（useShortcuts 模态守卫）与
 * 画布空格平移（Canvas）都须让位——两处共用本判定，避免选择器各自漂移。
 */

/** 任一模态（dialog / alertdialog）当前是否挂载在文档中。SSG 下安全返回 false。 */
export function isModalOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
}
