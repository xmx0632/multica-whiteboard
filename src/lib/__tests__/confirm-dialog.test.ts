/**
 * 自定义确认弹窗单测（ZOO-209）：
 *
 * - resolveConfirmDialogKey：Enter 确认 / Esc 取消 / Tab·Shift+Tab 焦点圈定循环、
 *   修饰组合不劫持、其余按键放行（Space 归原生按钮激活）；
 * - confirmDialog store：settle 正确 resolve true / false；并发第二请求把前一
 *   Promise 以 false 了结（不悬挂）；settled 后再 settle 不重复 resolve；
 * - confirmDiscardNew：请求文案来自 i18n（zh-CN 基准），danger 警示位就位；
 * - 与 ZOO-205 键位表不冲突：Enter / Tab 不在 KEY_BINDINGS（弹窗独占，快捷键
 *   层不会抢键——弹窗期间的隔离由模态守卫保证，见 useShortcuts）。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  resolveConfirmDialogKey,
  confirmDialog,
  confirmDiscardNew,
  useConfirmDialogStore,
} from '../confirmDialog';
import { matchEvent } from '../keymap';
import { getLibT } from '../../i18n/lib';

/** 合成 KeyboardEvent 形状（node 无 DOM，同 shortcut-system.test.ts 惯例） */
const key = (opts: { key: string; shift?: boolean; alt?: boolean; ctrl?: boolean; meta?: boolean }) => ({
  code: '',
  key: opts.key,
  shiftKey: opts.shift ?? false,
  altKey: opts.alt ?? false,
  ctrlKey: opts.ctrl ?? false,
  metaKey: opts.meta ?? false,
});

describe('resolveConfirmDialogKey（Enter / Esc / Tab 决策）', () => {
  it('Enter → 确认（owner 指定：一律确认，与系统 confirm 的 Enter=OK 同语义）', () => {
    expect(resolveConfirmDialogKey(key({ key: 'Enter' }), 2, 1)).toEqual({ kind: 'confirm' });
  });

  it('Escape → 取消', () => {
    expect(resolveConfirmDialogKey(key({ key: 'Escape' }), 2, 0)).toEqual({ kind: 'cancel' });
  });

  it('Tab 焦点圈定：取消(0) → 确认(1) → 取消(0) 循环，出不去', () => {
    expect(resolveConfirmDialogKey(key({ key: 'Tab' }), 2, 0)).toEqual({ kind: 'focus', index: 1 });
    expect(resolveConfirmDialogKey(key({ key: 'Tab' }), 2, 1)).toEqual({ kind: 'focus', index: 0 });
  });

  it('Shift+Tab 反向循环：确认(1) → 取消(0) → 确认(1)', () => {
    expect(resolveConfirmDialogKey(key({ key: 'Tab', shift: true }), 2, 1)).toEqual({ kind: 'focus', index: 0 });
    expect(resolveConfirmDialogKey(key({ key: 'Tab', shift: true }), 2, 0)).toEqual({ kind: 'focus', index: 1 });
  });

  it('焦点不在弹窗内（index=-1）：Tab 落首元素、Shift+Tab 落末元素', () => {
    expect(resolveConfirmDialogKey(key({ key: 'Tab' }), 3, -1)).toEqual({ kind: 'focus', index: 0 });
    expect(resolveConfirmDialogKey(key({ key: 'Tab', shift: true }), 3, -1)).toEqual({ kind: 'focus', index: 2 });
  });

  it('Tab 带 Alt/Ctrl/⌘ 修饰不劫持（浏览器 / 系统组合键）', () => {
    expect(resolveConfirmDialogKey(key({ key: 'Tab', alt: true }), 2, 0)).toBeNull();
    expect(resolveConfirmDialogKey(key({ key: 'Tab', ctrl: true }), 2, 0)).toBeNull();
    expect(resolveConfirmDialogKey(key({ key: 'Tab', meta: true }), 2, 0)).toBeNull();
  });

  it('其余按键放行：Space 归原生（激活聚焦按钮）、画布键不动作', () => {
    expect(resolveConfirmDialogKey(key({ key: ' ' }), 2, 0)).toBeNull();
    expect(resolveConfirmDialogKey(key({ key: 'p' }), 2, 0)).toBeNull();
    expect(resolveConfirmDialogKey(key({ key: 'Delete' }), 2, 0)).toBeNull();
  });

  it('无可聚焦元素时 Tab 不动作（防御：空弹窗不崩溃）', () => {
    expect(resolveConfirmDialogKey(key({ key: 'Tab' }), 0, -1)).toBeNull();
  });
});

describe('confirmDialog store（Promise 语义）', () => {
  beforeEach(() => {
    useConfirmDialogStore.getState().settle(false);
  });

  it('settle(true/false) 对应 resolve true/false，请求随之清空', async () => {
    const p = confirmDialog({ title: '清空所有元素？' });
    expect(useConfirmDialogStore.getState().request?.title).toBe('清空所有元素？');
    useConfirmDialogStore.getState().settle(true);
    expect(await p).toBe(true);
    expect(useConfirmDialogStore.getState().request).toBeNull();
  });

  it('Esc / 取消路径：settle(false) → await 为 false（留在当前画布）', async () => {
    const p = confirmDialog({ title: 'x' });
    useConfirmDialogStore.getState().settle(false);
    expect(await p).toBe(false);
  });

  it('并发第二请求：前一 Promise 以 false 了结（不悬挂），展示后请求', async () => {
    const p1 = confirmDialog({ title: '第一个' });
    const p2 = confirmDialog({ title: '第二个' });
    expect(await p1).toBe(false);
    expect(useConfirmDialogStore.getState().request?.title).toBe('第二个');
    useConfirmDialogStore.getState().settle(false);
    expect(await p2).toBe(false);
  });

  it('已 settle 后再 settle 是无害空操作（不重复 resolve、不抛错）', async () => {
    const p = confirmDialog({ title: 'x' });
    useConfirmDialogStore.getState().settle(true);
    useConfirmDialogStore.getState().settle(true); // 退出动画期的迟到按键防御
    expect(await p).toBe(true);
  });
});

describe('confirmDiscardNew（新建丢弃确认请求构造）', () => {
  it('标题 / 正文 / 按钮文案来自 i18n，danger 警示位就位', async () => {
    const zhT = getLibT('zh-CN');
    const p = confirmDiscardNew(zhT);
    const req = useConfirmDialogStore.getState().request;
    expect(req).toMatchObject({
      title: '放弃未保存的修改？',
      body: '新建白板将丢弃当前未保存的修改，此操作无法撤销。',
      confirmText: '放弃修改',
      cancelText: '取消',
      danger: true,
    });
    useConfirmDialogStore.getState().settle(false);
    expect(await p).toBe(false);
  });
});

describe('与 ZOO-205 键位表不冲突', () => {
  it('Enter / Tab 不在 KEY_BINDINGS：弹窗独占这两键，快捷键层不会抢键', () => {
    expect(matchEvent(key({ key: 'Enter' }))).toBeNull();
    expect(matchEvent(key({ key: 'Tab' }))).toBeNull();
    expect(matchEvent(key({ key: 'Tab', shift: true }))).toBeNull();
  });
});
