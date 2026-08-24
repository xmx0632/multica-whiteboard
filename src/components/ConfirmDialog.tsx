'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useConfirmDialogStore, resolveConfirmDialogKey } from '@/lib/confirmDialog';
import { useI18n } from '@/i18n/I18nProvider';

/**
 * 自定义确认弹窗（ZOO-209）：window.confirm 的样式化替代，portal 到 body 单例挂载
 * （WhiteboardApp 一处），请求经 confirmDialog() 命令式发起（confirmDialog.ts）。
 *
 * - 键盘：Enter 确认 / Esc 取消 / Tab 焦点圈定（决策纯函数沉淀在 confirmDialog.ts，
 *   本组件只做接线）；Space 交还原生（激活聚焦按钮）。
 * - 焦点：打开落确认钮，关闭还原触发元素（含 Alt+N 触发时焦点在 body 的情形）。
 * - 快捷键隔离：role=alertdialog 被 useShortcuts / Canvas 的模态守卫识别，
 *   弹窗期间画布快捷键与空格平移全部失效；遮罩盖满视口，画布不可交互。
 * - 动画：进出场 150ms 过渡（globals.css .confirm-overlay / .confirm-card）；
 *   退出帧由 store 的 closing 承载（组件零本地状态），动画放完调 finishClose 卸载。
 */
/** 退出过渡时长（ms），与 globals.css 动画时长同源 */
const EXIT_MS = 150;

/** 弹窗内可聚焦元素（焦点圈定候选集，文档序） */
function focusablesOf(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((el) => !el.hasAttribute('disabled'));
}

export default function ConfirmDialog() {
  const { t } = useI18n();
  const request = useConfirmDialogStore((s) => s.request);
  const closing = useConfirmDialogStore((s) => s.closing);
  const settle = useConfirmDialogStore((s) => s.settle);

  // 展示帧 = 活动请求 ?? 退出动画最后一帧；leaving 标记走退出过渡样式
  const shown = request ?? closing;
  const leaving = !request && !!closing;
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // 开：先记下触发元素（还原用）——须在下方落焦点效应之前执行（声明序即执行序）
  useEffect(() => {
    if (request) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [request]);

  // 焦点落位：弹窗出现（或叠开新请求）后焦点落在确认钮（默认动作，Enter 直接确认）
  useEffect(() => {
    if (request) cardRef.current?.querySelector<HTMLButtonElement>('[data-confirm]')?.focus();
  }, [request]);

  // 关：立即还原焦点到触发元素（不等退出动画）
  useEffect(() => {
    if (leaving) {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    }
  }, [leaving]);

  // 退出过渡放完卸载弹窗（期间叠开新请求则空操作）
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => useConfirmDialogStore.getState().finishClose(), EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  // 键位接线：Enter / Esc / Tab（决策见 resolveConfirmDialogKey）
  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (leaving) return;
      const card = cardRef.current;
      if (!card) return;
      const focusables = focusablesOf(card);
      const focusedIndex = focusables.indexOf(document.activeElement as HTMLElement);
      const action = resolveConfirmDialogKey(e, focusables.length, focusedIndex);
      if (!action) return;
      e.preventDefault();
      if (action.kind === 'confirm') settle(true);
      else if (action.kind === 'cancel') settle(false);
      else focusables[action.index]?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shown, leaving, settle]);

  // SSG 防御（同 ShortcutsHelpPanel）：仅由用户交互在客户端拉起
  if (typeof document === 'undefined' || !shown) return null;

  const confirmText = shown.confirmText ?? t('confirm.ok');
  const cancelText = shown.cancelText ?? t('confirm.cancel');

  return createPortal(
    <div
      className="confirm-overlay whiteboard-chrome fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      data-leaving={leaving ? 'true' : undefined}
      onClick={() => settle(false)}
    >
      <div
        ref={cardRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={shown.body ? 'confirm-dialog-body' : undefined}
        className="confirm-card bg-white rounded-2xl shadow-2xl w-[360px] max-w-[calc(100vw-1.5rem)] p-5"
        data-leaving={leaving ? 'true' : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-gray-800">
          {shown.title}
        </h2>
        {shown.body && (
          <p id="confirm-dialog-body" className="mt-2 text-sm text-gray-500 leading-relaxed">
            {shown.body}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(false)}
            className="touch-target px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100"
          >
            {cancelText}
          </button>
          <button
            type="button"
            data-confirm
            onClick={() => settle(true)}
            className={`touch-target px-3 py-1.5 text-sm rounded-lg text-white ${
              shown.danger
                ? 'bg-red-500 hover:bg-red-600 active:bg-red-700'
                : 'bg-blue-500 hover:bg-blue-600 active:bg-blue-700'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
