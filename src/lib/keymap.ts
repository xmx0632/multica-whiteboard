/**
 * 快捷键统一接管层（ZOO-205 阶段二）：全站快捷键的唯一配置源。
 *
 * 分层规则（v4 定稿，owner 确认）：
 * - 编辑命令 = Ctrl/Cmd 惯例键（Z 撤销 / C 复制 / V 粘贴 / X 剪切 / D 复制并平移 / A 全选）；
 * - 工具 / 文件 / 视图 = Alt（Mac ⌥）体系，无裸单字母快捷键；
 * - 帮助面板 Alt+/；Esc / Delete / Backspace / [ ] / PageUp / PageDown / 空格平移保留通用习惯。
 *
 * 匹配一律用 KeyboardEvent.code（物理键位）+ 修饰键精确相等：Mac 上 Option+字母的
 * e.key 是特殊字符（⌥V→√、⌥N→死键 ˜），按 e.key 匹配会在 Mac 静默失效；e.code
 * 两平台一致，一套配置 Mac / Windows 行为相同。修饰键精确相等同时天然排除
 * AltGr（Windows 欧洲键盘 AltGr = Ctrl+Alt，ctrl 位不等 → 不匹配 Alt 系）。
 *
 * 规避的浏览器占用组合（不可拦截，不设键）：Ctrl+N/T/W、Alt+D（地址栏）、
 * Alt+E / Alt+F（Chrome/Edge 菜单）、Alt+Home、Alt+←/→、Ctrl+PgUp/PgDn（切标签）。
 */
import { create } from 'zustand';

export type ShortcutId =
  // 工具（Alt+字母；penAlias / circleAlias 为历史习惯别名）
  | 'tool.select' | 'tool.hand' | 'tool.pen' | 'tool.penAlias'
  | 'tool.rectangle' | 'tool.circle' | 'tool.circleAlias' | 'tool.diamond' | 'tool.line'
  | 'tool.arrow' | 'tool.text' | 'tool.eraser' | 'tool.equation'
  // 编辑（Ctrl/Cmd 惯例）
  | 'edit.undo' | 'edit.redo' | 'edit.redoAlias' | 'edit.selectAll'
  | 'edit.copy' | 'edit.paste' | 'edit.cut' | 'edit.duplicate'
  | 'edit.delete' | 'edit.deleteBackspace' | 'edit.moveUp' | 'edit.moveDown'
  // 文件（Alt+字母）
  | 'file.new' | 'file.save'
  // 视图（Alt+符号；PageUp/PageDown 为非字母编辑键）
  | 'view.zoomIn' | 'view.zoomOut' | 'view.zoomReset' | 'view.zoomFit'
  | 'view.prevBoard' | 'view.nextBoard'
  // 页内翻页（分页帧 ZOO-198，方向键非字母键）
  | 'page.prev' | 'page.next'
  // 通用
  | 'ui.help' | 'ui.escape';

export type ShortcutGroup = 'tools' | 'file' | 'edit' | 'view' | 'general';

export interface KeyBinding {
  id: ShortcutId;
  group: ShortcutGroup;
  /** 帮助面板 / tooltip 的 i18n key（点分路径） */
  labelKey: string;
  /** KeyboardEvent.code（Alt 系与 Ctrl 系字母/数字键一律用 code 匹配） */
  code?: string;
  /** 无修饰歧义的编辑键（Escape / PageUp / Delete / [ ]）用 e.key 匹配 */
  key?: string;
  altKey?: boolean;
  shiftKey?: boolean;
  /** Ctrl（Win/Linux）/ ⌘（Mac）——匹配时 e.ctrlKey || e.metaKey */
  ctrlKey?: boolean;
  /** 别名不进帮助面板（主键已展示，如 Alt+B 画笔别名） */
  hidden?: boolean;
}

export const KEY_BINDINGS: KeyBinding[] = [
  // —— 工具切换（Alt+字母）——
  { id: 'tool.select', group: 'tools', labelKey: 'toolbar.select', code: 'KeyV', altKey: true },
  { id: 'tool.hand', group: 'tools', labelKey: 'toolbar.hand', code: 'KeyH', altKey: true },
  { id: 'tool.pen', group: 'tools', labelKey: 'toolbar.pen', code: 'KeyP', altKey: true },
  { id: 'tool.penAlias', group: 'tools', labelKey: 'toolbar.pen', code: 'KeyB', altKey: true, hidden: true },
  { id: 'tool.rectangle', group: 'tools', labelKey: 'toolbar.rectangle', code: 'KeyR', altKey: true },
  { id: 'tool.circle', group: 'tools', labelKey: 'toolbar.circle', code: 'KeyO', altKey: true },
  { id: 'tool.circleAlias', group: 'tools', labelKey: 'toolbar.circle', code: 'KeyC', altKey: true, hidden: true },
  // 菱形（ZOO-217）：Alt+I——Alt+D 被浏览器地址栏占用，取空闲字母 I
  { id: 'tool.diamond', group: 'tools', labelKey: 'toolbar.diamond', code: 'KeyI', altKey: true },
  { id: 'tool.line', group: 'tools', labelKey: 'toolbar.line', code: 'KeyL', altKey: true },
  { id: 'tool.arrow', group: 'tools', labelKey: 'toolbar.arrow', code: 'KeyA', altKey: true },
  { id: 'tool.text', group: 'tools', labelKey: 'toolbar.text', code: 'KeyT', altKey: true },
  { id: 'tool.eraser', group: 'tools', labelKey: 'toolbar.eraser', code: 'KeyX', altKey: true },
  { id: 'tool.equation', group: 'tools', labelKey: 'toolbar.equation', code: 'KeyG', altKey: true },
  // —— 编辑命令（Ctrl/Cmd 惯例键）——
  { id: 'edit.undo', group: 'edit', labelKey: 'menu.undo', code: 'KeyZ', ctrlKey: true },
  { id: 'edit.redo', group: 'edit', labelKey: 'menu.redo', code: 'KeyZ', ctrlKey: true, shiftKey: true },
  { id: 'edit.redoAlias', group: 'edit', labelKey: 'menu.redo', code: 'KeyY', ctrlKey: true, hidden: true },
  { id: 'edit.selectAll', group: 'edit', labelKey: 'shortcuts.selectAll', code: 'KeyA', ctrlKey: true },
  { id: 'edit.copy', group: 'edit', labelKey: 'shortcuts.copy', code: 'KeyC', ctrlKey: true },
  { id: 'edit.paste', group: 'edit', labelKey: 'shortcuts.paste', code: 'KeyV', ctrlKey: true },
  { id: 'edit.cut', group: 'edit', labelKey: 'shortcuts.cut', code: 'KeyX', ctrlKey: true },
  { id: 'edit.duplicate', group: 'edit', labelKey: 'shortcuts.duplicate', code: 'KeyD', ctrlKey: true },
  { id: 'edit.delete', group: 'edit', labelKey: 'shortcuts.delete', key: 'Delete' },
  { id: 'edit.deleteBackspace', group: 'edit', labelKey: 'shortcuts.delete', key: 'Backspace', hidden: true },
  { id: 'edit.moveUp', group: 'edit', labelKey: 'shortcuts.moveUp', key: ']' },
  { id: 'edit.moveDown', group: 'edit', labelKey: 'shortcuts.moveDown', key: '[' },
  // —— 文件（Alt+字母）——
  { id: 'file.new', group: 'file', labelKey: 'menu.new', code: 'KeyN', altKey: true },
  { id: 'file.save', group: 'file', labelKey: 'menu.save', code: 'KeyS', altKey: true },
  // —— 视图（Alt+符号 / 编辑键）——
  { id: 'view.zoomIn', group: 'view', labelKey: 'shortcuts.zoomIn', code: 'Equal', altKey: true },
  { id: 'view.zoomOut', group: 'view', labelKey: 'shortcuts.zoomOut', code: 'Minus', altKey: true },
  { id: 'view.zoomReset', group: 'view', labelKey: 'shortcuts.zoomReset', code: 'Digit0', altKey: true },
  { id: 'view.zoomFit', group: 'view', labelKey: 'shortcuts.zoomFit', code: 'Digit0', altKey: true, shiftKey: true },
  { id: 'view.prevBoard', group: 'view', labelKey: 'shortcuts.prevBoard', key: 'PageUp' },
  { id: 'view.nextBoard', group: 'view', labelKey: 'shortcuts.nextBoard', key: 'PageDown' },
  // —— 页内翻页（ZOO-198 分页帧）：方向键非字母键，不违反"无裸单字母"；与 PPT 翻页直觉一致 ——
  { id: 'page.prev', group: 'view', labelKey: 'shortcuts.prevPage', key: 'ArrowLeft' },
  { id: 'page.next', group: 'view', labelKey: 'shortcuts.nextPage', key: 'ArrowRight' },
  // —— 通用 ——
  { id: 'ui.help', group: 'general', labelKey: 'shortcuts.helpPanel', code: 'Slash', altKey: true },
  { id: 'ui.escape', group: 'general', labelKey: 'shortcuts.escape', key: 'Escape' },
];

/** 事件是否命中绑定：修饰键精确相等 + code（或无歧义键的 key）相等。 */
export function matchShortcut(e: { code: string; key: string; altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, b: KeyBinding): boolean {
  if ((b.altKey ?? false) !== e.altKey) return false;
  if ((b.shiftKey ?? false) !== e.shiftKey) return false;
  if ((b.ctrlKey ?? false) !== (e.ctrlKey || e.metaKey)) return false;
  return b.code ? e.code === b.code : e.key === b.key;
}

/** 事件命中的第一个绑定（无命中返回 null） */
export function matchEvent(e: Parameters<typeof matchShortcut>[0]): KeyBinding | null {
  for (const b of KEY_BINDINGS) if (matchShortcut(e, b)) return b;
  return null;
}

/** Mac 平台判定（帮助面板 / tooltip 展示 ⌘⌥ 符号用；SSG 下安全返回 false） */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

const CODE_LABELS: Record<string, string> = {
  Equal: '=', Minus: '-', Slash: '/', Digit0: '0', Digit1: '1', Digit2: '2',
  Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8',
  Digit9: '9', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.',
};

function codeLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  return code;
}

/** 绑定 → 展示文案（绑定跨平台一致，仅修饰键符号按平台显示） */
export function formatShortcut(b: KeyBinding, mac: boolean): string {
  const parts: string[] = [];
  if (b.ctrlKey) parts.push(mac ? '⌘' : 'Ctrl');
  if (b.altKey) parts.push(mac ? '⌥' : 'Alt');
  if (b.shiftKey) parts.push(mac ? '⇧' : 'Shift');
  const tail = b.code ? codeLabel(b.code) : (b.key ?? '');
  parts.push(tail);
  return mac ? parts.join('') : parts.join('+');
}

/** 工具类型 → 主绑定 id（LeftToolbar tooltip 用，别名不展示） */
export const TOOL_BINDING: Record<string, ShortcutId> = {
  hand: 'tool.hand', select: 'tool.select', pen: 'tool.pen', rectangle: 'tool.rectangle',
  circle: 'tool.circle', diamond: 'tool.diamond', line: 'tool.line', arrow: 'tool.arrow',
  text: 'tool.text', eraser: 'tool.eraser', equation: 'tool.equation',
};

/** 帮助面板开合（useShortcuts 分派器与面板组件共享；模态打开期间其余快捷键失效） */
export const useShortcutUI = create<{
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
}>((set) => ({
  helpOpen: false,
  setHelpOpen: (open) => set({ helpOpen: open }),
}));
