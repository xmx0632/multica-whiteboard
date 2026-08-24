/**
 * 自定义确认弹窗（ZOO-209）：替代 window.confirm 的可复用确认对话框——
 * Promise 语义与原生一致（true=确认 / false=取消），Enter 确认 / Esc 取消 / Tab 焦点圈定。
 *
 * 分层：本文件 = 请求状态（zustand）+ 命令式入口 + 纯键位决策（可单测，node 无 DOM）；
 * ConfirmDialog.tsx = 渲染与焦点管理（portal 到 body）。调用方（组件 / 快捷键层）
 * 只接触 confirmDialog()，不感知弹窗挂载。
 */
import { create } from 'zustand';
import type { LibT } from '@/i18n/lib';

/** 一次确认请求：标题必填，正文 / 按钮文案 / 危险级别可选（组件内有兜底文案） */
export interface ConfirmDialogRequest {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险动作（放弃修改 / 删除）：确认钮警示红；普通动作主色 */
  danger?: boolean;
}

interface ConfirmDialogState {
  request: ConfirmDialogRequest | null;
  /** 退出动画的最后一帧：settle 时由 request 移入，动画放完由组件调 finishClose 清零 */
  closing: ConfirmDialogRequest | null;
  resolver: ((ok: boolean) => void) | null;
  /** 挂起新请求（已有弹窗时旧 Promise 以 false 了结，不悬挂） */
  open: (request: ConfirmDialogRequest, resolver: (ok: boolean) => void) => void;
  /** 用户抉择落定：resolve Promise 并清请求（组件据此收尾 + 还原焦点） */
  settle: (ok: boolean) => void;
  /** 退出过渡结束：卸载弹窗（期间有新请求则空操作） */
  finishClose: () => void;
}

export const useConfirmDialogStore = create<ConfirmDialogState>((set, get) => ({
  request: null,
  closing: null,
  resolver: null,
  open: (request, resolver) => {
    get().resolver?.(false);
    set({ request, resolver, closing: null });
  },
  settle: (ok) => {
    const { resolver, request } = get();
    set({ request: null, resolver: null, closing: request });
    resolver?.(ok);
  },
  finishClose: () => {
    if (!get().request) set({ closing: null });
  },
}));

/**
 * 命令式入口（替代 window.confirm）：await confirmDialog({...}) → true / false。
 * 弹窗单例——并发第二次调用会取消前一次（前一个 Promise 得 false）。
 */
export function confirmDialog(request: ConfirmDialogRequest): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmDialogStore.getState().open(request, resolve);
  });
}

/** 「新建」丢弃未保存修改确认（ZOO-209）：顶栏按钮与 Alt+N 共用的请求构造 */
export function confirmDiscardNew(t: LibT): Promise<boolean> {
  return confirmDialog({
    title: t('confirm.discardTitle'),
    body: t('confirm.discardBody'),
    confirmText: t('confirm.discardConfirm'),
    cancelText: t('confirm.cancel'),
    danger: true,
  });
}

/**
 * 弹窗键位决策（纯函数，组件只做接线——同 keymap.ts 惯例）：
 * - Enter → 确认（owner 指定，与系统 confirm 的 Enter=OK 同语义，一律确认）；
 * - Escape → 取消；
 * - Tab / Shift+Tab → 焦点圈定（在弹窗可聚焦元素间循环；带 Alt/Ctrl/⌘ 修饰
 *   不劫持——那是浏览器 / 系统组合键）；
 * - 其余按键不动作（交还原生行为，如 Space 激活聚焦按钮）。
 */
export type ConfirmDialogKeyAction =
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'focus'; index: number }
  | null;

export function resolveConfirmDialogKey(
  e: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  focusableCount: number,
  focusedIndex: number,
): ConfirmDialogKeyAction {
  if (e.key === 'Enter') return { kind: 'confirm' };
  if (e.key === 'Escape') return { kind: 'cancel' };
  if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
    if (focusableCount <= 0) return null;
    // 焦点不在弹窗内（focusedIndex=-1，理论上不该发生）时 Tab 落到首 / 末元素
    if (focusedIndex < 0) return { kind: 'focus', index: e.shiftKey ? focusableCount - 1 : 0 };
    const dir = e.shiftKey ? -1 : 1;
    return { kind: 'focus', index: (focusedIndex + dir + focusableCount) % focusableCount };
  }
  return null;
}
