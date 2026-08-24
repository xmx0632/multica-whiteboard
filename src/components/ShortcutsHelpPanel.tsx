'use client';

import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { KEY_BINDINGS, formatShortcut, isMacPlatform, useShortcutUI, ShortcutGroup, KeyBinding } from '@/lib/keymap';
import { useI18n } from '@/i18n/I18nProvider';

/**
 * 快捷键帮助面板（ZOO-205）：Alt+/ 或顶栏「?」呼出，Esc / 点击遮罩 / × 关闭。
 *
 * 展示内容直接由 keymap.ts 配置表驱动（隐藏别名不展示）——面板与实际键位
 * 永远一致（验收标准）；按键文案仅修饰键符号按平台显示（Win: Alt+V / Mac: ⌥V），
 * 绑定本身跨平台同一套。Esc 关闭走 useShortcuts 全局优先级链（helpOpen 最先）；
 * 面板打开期间全局快捷键除 Esc / Alt+/ 外失效（useShortcuts 模态守卫）。
 */
const GROUP_ORDER: ShortcutGroup[] = ['tools', 'file', 'edit', 'view', 'general'];

export default function ShortcutsHelpPanel() {
  const { t } = useI18n();
  const helpOpen = useShortcutUI((s) => s.helpOpen);
  const setHelpOpen = useShortcutUI((s) => s.setHelpOpen);

  const mac = useMemo(() => isMacPlatform(), []);
  const grouped = useMemo(() => {
    const map = new Map<ShortcutGroup, KeyBinding[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const b of KEY_BINDINGS) {
      if (b.hidden) continue; // 别名键（Alt+B 画笔 / Ctrl+Y 重做）不单列
      map.get(b.group)!.push(b);
    }
    return map;
  }, []);

  // SSG 防御（mathplot-demo 静态导出）：面板仅由用户交互在客户端拉起，服务端一律不渲染
  if (typeof document === 'undefined' || !helpOpen) return null;

  return createPortal(
    <div
      className="whiteboard-chrome fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={() => setHelpOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
        className="bg-white rounded-2xl shadow-2xl w-[560px] max-w-[calc(100vw-1.5rem)] max-h-[80vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-800">{t('shortcuts.title')}</h2>
          <button
            onClick={() => setHelpOpen(false)}
            aria-label={t('shortcuts.close')}
            className="touch-target text-gray-400 hover:text-gray-600 text-xl"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          {GROUP_ORDER.map((g) => (
            <section key={g} className="min-w-0">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                {t(`shortcuts.sections.${g}`)}
              </h3>
              <ul className="space-y-1">
                {grouped.get(g)!.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-700 truncate">{t(b.labelKey)}</span>
                    <kbd className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-xs text-gray-600 font-mono">
                      {formatShortcut(b, mac)}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-100 space-y-1 text-xs text-gray-400">
          <p>{t('shortcuts.noteInput')}</p>
          <p>{t('shortcuts.noteReserved')}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
